-- 050: Scheduled website refresh into the owner's review queue. Apply ONCE, after 049. Not idempotent.
--
-- Model: managers and up choose how often saved website sources are re-crawled: off (default), monthly,
-- weekly or daily, plus an optional sitemap URL used to find new and removed pages. The scheduled job
-- (POST /api/cron/refresh, service role) claims due workspaces, re-crawls with the same SSRF, robots.txt
-- and size limits as the owner's own import, and writes what changed to knowledge_refresh_items. Nothing is
-- published or overwritten here: the owner applies a change through the normal consent-checked Knowledge
-- save, or dismisses it. A saved website source is a knowledge source whose text starts with
-- "Source: <url>" (how the website import saves pages).

CREATE TABLE public.refresh_settings(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 frequency text NOT NULL DEFAULT 'off' CHECK(frequency IN('off','monthly','weekly','daily')),
 sitemap_url text CHECK(sitemap_url IS NULL OR (length(sitemap_url)<=500 AND sitemap_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^\s]*)?$')),
 last_run_at timestamptz,
 next_due_at timestamptz,
 last_summary jsonb CHECK(last_summary IS NULL OR (jsonb_typeof(last_summary)='object' AND pg_column_size(last_summary)<=2000)),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refresh_settings_due ON public.refresh_settings(next_due_at) WHERE frequency<>'off';
ALTER TABLE public.refresh_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refresh_settings FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_refresh_settings ON public.refresh_settings FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
GRANT SELECT ON public.refresh_settings TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.refresh_settings FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();

CREATE TABLE public.knowledge_refresh_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 document_id uuid REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
 url text NOT NULL CHECK(length(url) BETWEEN 9 AND 500 AND url ~ '^https?://'),
 kind text NOT NULL CHECK(kind IN('new','changed','removed')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 content text CHECK(content IS NULL OR length(content) BETWEEN 20 AND 30000),
 detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','applied','dismissed')),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 CHECK((kind='removed')=(content IS NULL)),
 CHECK(kind='new' OR document_id IS NOT NULL)
);
CREATE UNIQUE INDEX knowledge_refresh_pending_url ON public.knowledge_refresh_items(user_id,url) WHERE status='pending';
CREATE INDEX knowledge_refresh_ws_time ON public.knowledge_refresh_items(user_id,detected_at DESC);
ALTER TABLE public.knowledge_refresh_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_refresh_items FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_knowledge_refresh_items ON public.knowledge_refresh_items FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
GRANT SELECT ON public.knowledge_refresh_items TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_refresh_items FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();

CREATE FUNCTION public.refresh_interval(p_frequency text) RETURNS interval LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_frequency WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' WHEN 'monthly' THEN interval '30 days' END
$$;
GRANT EXECUTE ON FUNCTION public.refresh_interval(text) TO authenticated;

-- Managers and up. Turning a schedule on makes the workspace due at the next hourly run.
CREATE FUNCTION public.set_refresh_settings(p_frequency text,p_sitemap_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();u text:=nullif(btrim(coalesce(p_sitemap_url,'')),'');
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_frequency IS NULL OR p_frequency NOT IN('off','monthly','weekly','daily') THEN RAISE EXCEPTION 'Invalid frequency';END IF;
 INSERT INTO refresh_settings(user_id,frequency,sitemap_url,next_due_at) VALUES(uid,p_frequency,u,CASE WHEN p_frequency='off' THEN NULL ELSE clock_timestamp() END)
  ON CONFLICT(user_id) DO UPDATE SET frequency=EXCLUDED.frequency,sitemap_url=EXCLUDED.sitemap_url,updated_at=clock_timestamp(),
   next_due_at=CASE WHEN EXCLUDED.frequency='off' THEN NULL
    WHEN refresh_settings.last_run_at IS NULL THEN clock_timestamp()
    ELSE refresh_settings.last_run_at+public.refresh_interval(EXCLUDED.frequency) END;
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.set_refresh_settings(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_refresh_settings(text,text) TO authenticated;

-- Managers and up: mark one pending change applied (after saving it through Knowledge) or dismissed.
CREATE FUNCTION public.resolve_refresh_item(p_id uuid,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_status IS NULL OR p_status NOT IN('applied','dismissed') THEN RAISE EXCEPTION 'Invalid status';END IF;
 UPDATE knowledge_refresh_items SET status=p_status,resolved_at=clock_timestamp(),resolved_by=auth.uid() WHERE id=p_id AND user_id=uid AND status='pending';
 RETURN FOUND;
END$$;
REVOKE ALL ON FUNCTION public.resolve_refresh_item(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_refresh_item(uuid,text) TO authenticated;

-- Service role: claim up to p_limit due workspaces (1-10). A claim pushes next_due_at out by one hour, so a
-- crashed run is retried at the next hourly call and two overlapping calls never take the same workspace.
CREATE FUNCTION public.service_refresh_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
 WITH due AS (SELECT user_id FROM refresh_settings WHERE frequency<>'off' AND next_due_at<=clock_timestamp()
   ORDER BY next_due_at LIMIT least(greatest(coalesce(p_limit,3),1),10) FOR UPDATE SKIP LOCKED),
  claimed AS (UPDATE refresh_settings s SET next_due_at=clock_timestamp()+interval '1 hour' FROM due WHERE s.user_id=due.user_id RETURNING s.user_id,s.frequency,s.sitemap_url)
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspace',user_id,'frequency',frequency,'sitemapUrl',sitemap_url)),'[]'::jsonb) INTO r FROM claimed;
 RETURN r;
END$$;
-- Saved website sources of one workspace (latest 30).
CREATE FUNCTION public.service_refresh_sources(p_ws uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'content',content,'updatedAt',updated_at,'published',published) ORDER BY created_at DESC),'[]'::jsonb)
 FROM (SELECT id,title,content,updated_at,published,created_at FROM knowledge_documents
  WHERE user_id=p_ws AND source_kind='text' AND content ~ '^Source: https?://' ORDER BY created_at DESC LIMIT 30) d
$$;
-- Record one run: upsert pending changes (at most 100 pending per workspace), then schedule the next run.
CREATE FUNCTION public.service_refresh_record(p_ws uuid,p_items jsonb,p_summary jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE it jsonb;n integer:=0;doc uuid;
BEGIN
 IF p_ws IS NULL OR jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Invalid refresh run';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,50));
 FOR it IN SELECT jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LIMIT 100 LOOP
  EXIT WHEN (SELECT count(*) FROM knowledge_refresh_items WHERE user_id=p_ws AND status='pending')>=100
   AND NOT EXISTS(SELECT 1 FROM knowledge_refresh_items WHERE user_id=p_ws AND status='pending' AND url=it->>'url');
  doc:=NULL;
  IF it->>'documentId' IS NOT NULL THEN SELECT id INTO doc FROM knowledge_documents WHERE id=(it->>'documentId')::uuid AND user_id=p_ws;
   IF doc IS NULL THEN CONTINUE;END IF;
  END IF;
  INSERT INTO knowledge_refresh_items(user_id,document_id,url,kind,title,content)
   VALUES(p_ws,doc,it->>'url',it->>'kind',left(coalesce(nullif(btrim(it->>'title'),''),it->>'url'),120),CASE WHEN it->>'kind'='removed' THEN NULL ELSE left(it->>'content',30000) END)
   ON CONFLICT(user_id,url) WHERE status='pending' DO UPDATE SET document_id=EXCLUDED.document_id,kind=EXCLUDED.kind,title=EXCLUDED.title,content=EXCLUDED.content,detected_at=clock_timestamp();
  n:=n+1;
 END LOOP;
 DELETE FROM knowledge_refresh_items WHERE id IN(SELECT id FROM knowledge_refresh_items WHERE user_id=p_ws AND status<>'pending' ORDER BY detected_at DESC,id DESC OFFSET 200);
 UPDATE refresh_settings SET last_run_at=clock_timestamp(),last_summary=p_summary,
  next_due_at=CASE WHEN frequency='off' THEN NULL ELSE clock_timestamp()+public.refresh_interval(frequency) END WHERE user_id=p_ws;
 RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.service_refresh_claim(integer),public.service_refresh_sources(uuid),public.service_refresh_record(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_refresh_claim(integer),public.service_refresh_sources(uuid),public.service_refresh_record(uuid,jsonb,jsonb) TO service_role;

-- delete_preview_data: the 049 body plus the refresh queue and settings (before knowledge_documents).
CREATE OR REPLACE FUNCTION public.delete_preview_data(p_confirmation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('owner') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_confirmation IS DISTINCT FROM 'DELETE MY PREVIEW DATA' THEN RAISE EXCEPTION 'Explicit confirmation required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 -- Lock reviewed actions before checking, so concurrent confirmation cannot pass the deletion check.
 PERFORM 1 FROM action_proposals WHERE user_id=uid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM proof_operation_locks WHERE user_id=uid) OR EXISTS(SELECT 1 FROM action_proposals WHERE user_id=uid AND status IN('executing','needs_review')) THEN RAISE EXCEPTION 'Reconcile uncertain actions before deleting data';END IF;
 DELETE FROM catalog_ai_budget WHERE user_id=uid;
 DELETE FROM operational_events WHERE user_id=uid;
 DELETE FROM owner_alert_preferences WHERE user_id=uid;
 DELETE FROM owner_alert_checks WHERE user_id=uid;
 DELETE FROM email_log WHERE user_id=uid;
 DELETE FROM email_settings WHERE user_id=uid;
 DELETE FROM transcript_settings WHERE user_id=uid;
 DELETE FROM knowledge_refresh_items WHERE user_id=uid;
 DELETE FROM refresh_settings WHERE user_id=uid;
 DELETE FROM demo_webhooks WHERE user_id=uid;
 DELETE FROM mcp_calls WHERE user_id=uid;
 DELETE FROM readonly_tokens WHERE user_id=uid;
 DELETE FROM billing_verifications WHERE user_id=uid;
 DELETE FROM billing_lookups WHERE user_id=uid;
 DELETE FROM billing_connection_events WHERE user_id=uid;
 DELETE FROM billing_connections WHERE user_id=uid;
 DELETE FROM support_messages WHERE user_id=uid;
 DELETE FROM support_cases WHERE user_id=uid;
 DELETE FROM knowledge_attempts WHERE user_id=uid;
 DELETE FROM knowledge_documents WHERE user_id=uid;
 DELETE FROM custom_responses WHERE user_id=uid;
 DELETE FROM widget_settings WHERE user_id=uid;
 DELETE FROM proof_contracts WHERE user_id=uid;
 DELETE FROM action_proposals WHERE user_id=uid;
 DELETE FROM billing_events WHERE user_id=uid;
 DELETE FROM owner_audit_events WHERE user_id=uid;
 DELETE FROM workspace_invites WHERE workspace_id=uid;
 DELETE FROM workspace_members WHERE workspace_id=uid;
 RETURN true;
END;
$function$;
