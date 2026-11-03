-- 049: Full conversation transcripts with owner-set retention. Apply ONCE, after 048. Not idempotent.
--
-- Model: a conversation is a support case. Its transcript is the visitor questions and AI answers
-- (knowledge_interactions, which now also keeps the answer text and where it was asked), the person chat
-- (support_messages, from 045) and the visitor's requests (support_requests). Owners pick a retention of
-- 30, 90 (default) or 365 days. purge_expired_transcripts deletes every conversation, ticket included,
-- whose last activity is older than that; it is run by the scheduled job (POST /api/cron/refresh).
-- Managers and up can delete one conversation at once. delete_preview_data also removes the setting.

-- 1. Retention setting. Read by agents and up; changed by admins and up.
CREATE TABLE public.transcript_settings(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 retention_days integer NOT NULL DEFAULT 90 CHECK(retention_days IN(30,90,365)),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.transcript_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transcript_settings FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_transcript_settings ON public.transcript_settings FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
GRANT SELECT ON public.transcript_settings TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.transcript_settings FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();

CREATE FUNCTION public.set_transcript_retention(p_days integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_days IS NULL OR p_days NOT IN(30,90,365) THEN RAISE EXCEPTION 'Retention must be 30, 90 or 365 days';END IF;
 INSERT INTO transcript_settings(user_id,retention_days) VALUES(uid,p_days)
  ON CONFLICT(user_id) DO UPDATE SET retention_days=EXCLUDED.retention_days,updated_at=clock_timestamp();
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.set_transcript_retention(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_transcript_retention(integer) TO authenticated;

-- 2. AI answers and where the question was asked.
ALTER TABLE public.knowledge_interactions
 ADD COLUMN answer text CHECK(answer IS NULL OR char_length(answer) BETWEEN 1 AND 4000),
 ADD COLUMN source text NOT NULL DEFAULT 'widget' CHECK(source IN('widget','hosted_page','api','mcp'));
CREATE INDEX knowledge_interactions_case_time ON public.knowledge_interactions(case_id,created_at);
CREATE INDEX support_requests_case_time ON public.support_requests(case_id,created_at);

-- Visitor side (case link): store the answer shown for one reserved question, once. Unexpired link only.
CREATE FUNCTION public.support_record_answer(p_hash text,p_id uuid,p_answer text,p_source text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a text:=left(btrim(coalesce(p_answer,'')),4000);
BEGIN
 IF a='' OR coalesce(p_source,'') NOT IN('widget','hosted_page') THEN RETURN false;END IF;
 UPDATE knowledge_interactions i SET answer=a,source=p_source FROM support_cases c
  WHERE i.id=p_id AND i.case_id=c.id AND c.token_hash=p_hash AND c.expires_at>now() AND i.answer IS NULL;
 RETURN FOUND;
END$$;
REVOKE ALL ON FUNCTION public.support_record_answer(text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_record_answer(text,uuid,text,text) TO anon,authenticated;

-- 3. Last activity of a conversation (internal).
CREATE FUNCTION public.case_last_activity(p_case uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT greatest(c.created_at,c.ticket_updated_at,
  (SELECT max(created_at) FROM knowledge_interactions WHERE case_id=c.id),
  (SELECT max(created_at) FROM support_messages WHERE case_id=c.id),
  (SELECT max(created_at) FROM support_requests WHERE case_id=c.id))
 FROM support_cases c WHERE c.id=p_case
$$;
REVOKE ALL ON FUNCTION public.case_last_activity(uuid) FROM PUBLIC,anon,authenticated;

-- 4. Delete one conversation (manager and up, acting workspace). Cascades to its questions, answers,
-- messages, requests, ticket history and billing lookups. One audit row records who did it.
CREATE FUNCTION public.delete_conversation(p_case uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 DELETE FROM support_cases WHERE id=p_case AND user_id=uid;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,42));
 DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 999);
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(uid,'support_cases','DELETE',p_case,auth.uid());
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.delete_conversation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_conversation(uuid) TO authenticated;

-- 5. Retention purge (service role only, run by the scheduled job). At most p_limit conversations per call
-- (1-1000). Workspaces without a setting use 90 days. Each deletion leaves one audit row (actor = owner).
CREATE FUNCTION public.purge_expired_transcripts(p_limit integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer:=0;r record;
BEGIN
 FOR r IN SELECT c.id,c.user_id FROM support_cases c LEFT JOIN transcript_settings s ON s.user_id=c.user_id
  WHERE c.created_at<now()-interval '30 days'
   AND public.case_last_activity(c.id)<now()-make_interval(days=>coalesce(s.retention_days,90))
  ORDER BY c.created_at LIMIT least(greatest(coalesce(p_limit,200),1),1000) FOR UPDATE OF c SKIP LOCKED
 LOOP
  DELETE FROM support_cases WHERE id=r.id;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,42));
  DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=r.user_id ORDER BY created_at DESC,id DESC OFFSET 999);
  INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(r.user_id,'support_cases','DELETE',r.id,r.user_id);
  n:=n+1;
 END LOOP;
 RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.purge_expired_transcripts(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_transcripts(integer) TO service_role;

-- 6. delete_preview_data: the 048 body plus transcript_settings.
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
