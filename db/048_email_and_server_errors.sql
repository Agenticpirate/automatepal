-- 048: Email delivery (Resend) bookkeeping and server-error rows in the operational log. Apply ONCE, after 047.
-- Not idempotent.
--
-- Model: the app sends five kinds of email: owner alerts (a visitor asked for a person or a refund review
-- opened), the weekly digest, a new-lead notice, team invites and an owner reply sent to a visitor who gave
-- an email with consent. Every send is first reserved here: the reservation checks the workspace's email
-- settings and per-workspace caps, then writes one metadata row to email_log (type, sha256 of the
-- recipient address, status, provider message id; never the address, subject or body) and one owner audit
-- row. With no RESEND_API_KEY the app finishes the row as 'dry_run'. Owners turn each automatic kind off in
-- email_settings. Caps per workspace per UTC day: owner_alert 20, new_lead 20, team_invite 20,
-- visitor_reply 50, all kinds 100; weekly_digest once per 6 days. Suppressed attempts are logged too.
--
-- Server errors (Next.js onRequestError) are written to operational_events with user_id NULL, code
-- SERVER_ERROR, component 'server' and the route template, through a service-role-only function. Rows with
-- a NULL user_id are never visible to workspace members (the existing RLS policy compares user_id).

-- 1. Email settings. Read by managers and up; changed by admins and up through set_email_settings.
CREATE TABLE public.email_settings(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 owner_alerts boolean NOT NULL DEFAULT true,
 weekly_digest boolean NOT NULL DEFAULT true,
 new_leads boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_settings FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_email_settings ON public.email_settings FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
GRANT SELECT ON public.email_settings TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.email_settings FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();

CREATE FUNCTION public.set_email_settings(p_owner_alerts boolean,p_weekly_digest boolean,p_new_leads boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_owner_alerts IS NULL OR p_weekly_digest IS NULL OR p_new_leads IS NULL THEN RAISE EXCEPTION 'Invalid settings';END IF;
 INSERT INTO email_settings(user_id,owner_alerts,weekly_digest,new_leads) VALUES(uid,p_owner_alerts,p_weekly_digest,p_new_leads)
  ON CONFLICT(user_id) DO UPDATE SET owner_alerts=EXCLUDED.owner_alerts,weekly_digest=EXCLUDED.weekly_digest,new_leads=EXCLUDED.new_leads,updated_at=clock_timestamp();
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.set_email_settings(boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_email_settings(boolean,boolean,boolean) TO authenticated;

-- 2. Sent-email log: metadata only. Latest 1000 rows per workspace are kept.
CREATE TABLE public.email_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 email_type text NOT NULL CHECK(email_type IN('owner_alert','weekly_digest','new_lead','team_invite','visitor_reply')),
 recipient_hash text NOT NULL CHECK(recipient_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN('reserved','sent','dry_run','failed','suppressed_cap','suppressed_off')),
 provider_id text CHECK(provider_id IS NULL OR provider_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 finished_at timestamptz
);
CREATE INDEX email_log_ws_time ON public.email_log(user_id,created_at DESC);
CREATE INDEX email_log_ws_type_time ON public.email_log(user_id,email_type,created_at DESC);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_log FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_email_log ON public.email_log FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
GRANT SELECT ON public.email_log TO authenticated;

-- Internal: reserve one send for workspace p_ws. Returns {id, allowed, status}. Callers: the service-role
-- wrapper below (server jobs, visitor-triggered alerts) and email_reserve_member (signed-in flows).
CREATE FUNCTION public.email_reserve_internal(p_ws uuid,p_type text,p_recipient_hash text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s email_settings;st text:='reserved';rid uuid;day0 timestamptz:=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 counted text[]:=ARRAY['reserved','sent','dry_run','failed'];cap integer;
BEGIN
 IF p_ws IS NULL OR p_type NOT IN('owner_alert','weekly_digest','new_lead','team_invite','visitor_reply') OR p_recipient_hash IS NULL OR p_recipient_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid email reservation';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,48));
 SELECT * INTO s FROM email_settings WHERE user_id=p_ws;
 IF (p_type='owner_alert' AND s.owner_alerts IS FALSE) OR (p_type='weekly_digest' AND s.weekly_digest IS FALSE) OR (p_type='new_lead' AND s.new_leads IS FALSE) THEN st:='suppressed_off';END IF;
 IF st='reserved' THEN
  IF p_type='weekly_digest' THEN
   IF EXISTS(SELECT 1 FROM email_log WHERE user_id=p_ws AND email_type='weekly_digest' AND status=ANY(counted) AND created_at>now()-interval '6 days') THEN st:='suppressed_cap';END IF;
  ELSE
   cap:=CASE p_type WHEN 'visitor_reply' THEN 50 ELSE 20 END;
   IF(SELECT count(*) FROM email_log WHERE user_id=p_ws AND email_type=p_type AND status=ANY(counted) AND created_at>=day0)>=cap THEN st:='suppressed_cap';END IF;
  END IF;
  IF st='reserved' AND(SELECT count(*) FROM email_log WHERE user_id=p_ws AND status=ANY(counted) AND created_at>=day0)>=100 THEN st:='suppressed_cap';END IF;
 END IF;
 DELETE FROM email_log WHERE id IN(SELECT id FROM email_log WHERE user_id=p_ws ORDER BY created_at DESC,id DESC OFFSET 999);
 INSERT INTO email_log(user_id,email_type,recipient_hash,status,finished_at) VALUES(p_ws,p_type,p_recipient_hash,st,CASE WHEN st='reserved' THEN NULL ELSE clock_timestamp() END) RETURNING id INTO rid;
 -- Audit row (metadata only). Signed-in flows record the person; server jobs record the workspace owner.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,42));
 DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=p_ws ORDER BY created_at DESC,id DESC OFFSET 999);
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(p_ws,'email_log','INSERT',rid,coalesce(p_actor,p_ws));
 RETURN jsonb_build_object('id',rid,'allowed',st='reserved','status',st);
END$$;
REVOKE ALL ON FUNCTION public.email_reserve_internal(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.email_reserve(p_ws uuid,p_type text,p_recipient_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.email_reserve_internal(p_ws,p_type,p_recipient_hash,NULL) $$;
REVOKE ALL ON FUNCTION public.email_reserve(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_reserve(uuid,text,text) TO service_role;

-- Signed-in flows: team invites (manager and up) and replies to a visitor (agent and up), acting workspace only.
CREATE FUNCTION public.email_reserve_member(p_type text,p_recipient_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_type='team_invite' AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_type='visitor_reply' AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_type NOT IN('team_invite','visitor_reply') THEN RAISE EXCEPTION 'Invalid email reservation';END IF;
 RETURN public.email_reserve_internal(uid,p_type,p_recipient_hash,auth.uid());
END$$;
REVOKE ALL ON FUNCTION public.email_reserve_member(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_reserve_member(text,text) TO authenticated;

-- Finish a reserved row once: sent (with the provider id), dry_run or failed. email_finish is for the
-- service role; email_finish_member finishes only rows of the caller's acting workspace.
CREATE FUNCTION public.email_finish_internal(p_ws uuid,p_id uuid,p_status text,p_provider_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_status IS NULL OR p_status NOT IN('sent','dry_run','failed') OR (p_provider_id IS NOT NULL AND p_provider_id!~'^[A-Za-z0-9_-]{1,100}$') THEN RAISE EXCEPTION 'Invalid email status';END IF;
 UPDATE email_log SET status=p_status,provider_id=CASE WHEN p_status='sent' THEN p_provider_id END,finished_at=clock_timestamp()
  WHERE id=p_id AND status='reserved' AND (p_ws IS NULL OR user_id=p_ws);
 RETURN FOUND;
END$$;
REVOKE ALL ON FUNCTION public.email_finish_internal(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.email_finish(p_id uuid,p_status text,p_provider_id text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.email_finish_internal(NULL,p_id,p_status,p_provider_id) $$;
REVOKE ALL ON FUNCTION public.email_finish(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_finish(uuid,text,text) TO service_role;
CREATE FUNCTION public.email_finish_member(p_id uuid,p_status text,p_provider_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 RETURN public.email_finish_internal(ws,p_id,p_status,p_provider_id);
END$$;
REVOKE ALL ON FUNCTION public.email_finish_member(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_finish_member(uuid,text,text) TO authenticated;

-- Service-only lookups for server jobs: the workspace and id of a case link, and the owner's address.
CREATE FUNCTION public.service_case_ref(p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('workspace',user_id,'caseId',id) FROM support_cases WHERE token_hash=p_hash
$$;
CREATE FUNCTION public.service_owner_email(p_ws uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth AS $$
 SELECT email::text FROM auth.users WHERE id=p_ws AND email_confirmed_at IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.service_case_ref(text),public.service_owner_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_case_ref(text),public.service_owner_email(uuid) TO service_role;

-- Weekly digest numbers for one workspace (service only): last 7 days and the 7 before, plus the five
-- most frequent unanswered questions of the last 7 days. The digest goes to the workspace owner only.
CREATE FUNCTION public.service_weekly_digest(p_ws uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH w AS (SELECT now()-interval '7 days' a, now()-interval '14 days' b)
 SELECT jsonb_build_object(
  'questions',(SELECT count(*) FROM knowledge_interactions,w WHERE user_id=p_ws AND created_at>=w.a),
  'questionsPrev',(SELECT count(*) FROM knowledge_interactions,w WHERE user_id=p_ws AND created_at>=w.b AND created_at<w.a),
  'answered',(SELECT count(*) FROM knowledge_interactions,w WHERE user_id=p_ws AND supported AND created_at>=w.a),
  'answeredPrev',(SELECT count(*) FROM knowledge_interactions,w WHERE user_id=p_ws AND supported AND created_at>=w.b AND created_at<w.a),
  'handoffs',(SELECT count(*) FROM support_requests,w WHERE user_id=p_ws AND kind='human_handoff' AND created_at>=w.a),
  'handoffsPrev',(SELECT count(*) FROM support_requests,w WHERE user_id=p_ws AND kind='human_handoff' AND created_at>=w.b AND created_at<w.a),
  'leads',(SELECT count(*) FROM support_requests,w WHERE user_id=p_ws AND contact_consent AND contact_email IS NOT NULL AND created_at>=w.a),
  'leadsPrev',(SELECT count(*) FROM support_requests,w WHERE user_id=p_ws AND contact_consent AND contact_email IS NOT NULL AND created_at>=w.b AND created_at<w.a),
  'topUnanswered',coalesce((SELECT jsonb_agg(jsonb_build_object('question',q,'count',n)) FROM (
    SELECT min(question) q,count(*) n FROM knowledge_interactions,w WHERE user_id=p_ws AND NOT supported AND created_at>=w.a
    GROUP BY lower(regexp_replace(btrim(question),'\s+',' ','g')) ORDER BY count(*) DESC,min(question) LIMIT 5) t),'[]'::jsonb))
$$;
-- Workspaces due a digest: activity in the last 14 days, digest on, none counted in the last 6 days.
CREATE FUNCTION public.service_digest_due(p_limit integer) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT DISTINCT k.user_id FROM knowledge_interactions k
 WHERE k.created_at>=now()-interval '14 days'
  AND NOT EXISTS(SELECT 1 FROM email_settings s WHERE s.user_id=k.user_id AND NOT s.weekly_digest)
  AND NOT EXISTS(SELECT 1 FROM email_log l WHERE l.user_id=k.user_id AND l.email_type='weekly_digest' AND l.status IN('reserved','sent','dry_run','failed') AND l.created_at>now()-interval '6 days')
 LIMIT least(greatest(coalesce(p_limit,10),1),50)
$$;
REVOKE ALL ON FUNCTION public.service_weekly_digest(uuid),public.service_digest_due(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_weekly_digest(uuid),public.service_digest_due(integer) TO service_role;

-- 3. Server errors in the operational log.
ALTER TABLE public.operational_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.operational_events ADD COLUMN route text CHECK(route IS NULL OR route ~ '^[A-Za-z0-9_/\[\]().@-]{1,200}$');
ALTER TABLE public.operational_events DROP CONSTRAINT operational_events_code_check;
ALTER TABLE public.operational_events ADD CONSTRAINT operational_events_code_check CHECK(code IN('TICKET_READ_FAILED','TICKET_WRITE_FAILED','OWNER_SNAPSHOT_FAILED','ALERT_RULE_FAILED','SAFE_RETRY_STARTED','SAFE_RETRY_RECOVERED','SAFE_RETRY_EXHAUSTED','SERVER_ERROR'));
ALTER TABLE public.operational_events DROP CONSTRAINT operational_events_component_check;
ALTER TABLE public.operational_events ADD CONSTRAINT operational_events_component_check CHECK(component IN('tickets','owner','alerts','health','server'));
ALTER TABLE public.operational_events ADD CONSTRAINT operational_events_server_rows CHECK((code='SERVER_ERROR')=(user_id IS NULL) AND (code='SERVER_ERROR')=(component='server'));
CREATE INDEX operational_events_server_time ON public.operational_events(created_at DESC) WHERE user_id IS NULL;
-- Metadata only: the request id, the route template, the release and the time. Latest 2000 kept, 14 days.
CREATE FUNCTION public.record_server_error(p_request uuid,p_route text,p_release text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_request IS NULL OR p_route IS NULL OR p_route!~'^[A-Za-z0-9_/\[\]().@-]{1,200}$' OR p_release IS NULL OR p_release!~'^[a-zA-Z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'Invalid server error row';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('server-errors',48));
 DELETE FROM operational_events WHERE user_id IS NULL AND created_at<now()-interval '14 days';
 DELETE FROM operational_events WHERE id IN(SELECT id FROM operational_events WHERE user_id IS NULL ORDER BY created_at DESC,id DESC OFFSET 1999);
 INSERT INTO operational_events(user_id,request_id,code,severity,component,release,attempt,route) VALUES(NULL,p_request,'SERVER_ERROR','error','server',p_release,1,p_route)
  ON CONFLICT DO NOTHING;
 RETURN true;
END$$;
-- Recent server-error counts (service only), for OPERATIONS.md and the alert webhook.
CREATE FUNCTION public.server_error_summary(p_minutes integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('minutes',least(greatest(coalesce(p_minutes,60),1),20160),'groups',coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)) FROM (
  SELECT route,release,count(*) AS count,max(created_at) AS latest FROM operational_events
  WHERE user_id IS NULL AND created_at>=now()-make_interval(mins=>least(greatest(coalesce(p_minutes,60),1),20160)) GROUP BY route,release ORDER BY count(*) DESC LIMIT 50) x
$$;
REVOKE ALL ON FUNCTION public.record_server_error(uuid,text,text),public.server_error_summary(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_server_error(uuid,text,text),public.server_error_summary(integer) TO service_role;

-- 4. delete_preview_data: the 046 body plus email_log and email_settings.
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
