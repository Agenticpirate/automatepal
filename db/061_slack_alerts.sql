-- Slack alerts (Phase 3). An admin pastes a Slack incoming-webhook URL (Slack › Apps › Incoming Webhooks); the
-- server posts a short message when a visitor asks for a person, a refund review opens or a lead arrives. Like
-- the email alerts, messages carry no visitor text: an event name, a ticket reference and a dashboard link.
-- The URL is a secret: stored here, never returned to the browser (only whether it is set and its last 4
-- characters). Integrations need a plan with webhooks (Growth and up, db/057).
CREATE TABLE public.slack_settings(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 webhook_url text NOT NULL CHECK(webhook_url ~ '^https://hooks\.slack\.com/services/[A-Za-z0-9]+/[A-Za-z0-9]+/[A-Za-z0-9]{8,64}$'),
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.slack_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slack_settings FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.set_slack_settings(p_url text,p_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_url IS NULL THEN DELETE FROM slack_settings WHERE user_id=ws;RETURN true;END IF;
 IF coalesce(p_enabled,true) AND NOT public.workspace_has_feature(ws,'webhooks') THEN RAISE EXCEPTION 'Upgrade required: Slack alerts are not included in your plan';END IF;
 INSERT INTO slack_settings(user_id,webhook_url,enabled,updated_at) VALUES(ws,p_url,coalesce(p_enabled,true),now())
  ON CONFLICT(user_id) DO UPDATE SET webhook_url=excluded.webhook_url,enabled=excluded.enabled,updated_at=now();
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(ws,'slack_settings','UPDATE',ws,auth.uid());
 RETURN true;
END$$;
CREATE FUNCTION public.my_slack_settings() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();s slack_settings;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RETURN NULL;END IF;
 SELECT * INTO s FROM slack_settings WHERE user_id=ws;
 RETURN jsonb_build_object('configured',s.user_id IS NOT NULL,'enabled',coalesce(s.enabled,false),'hint',CASE WHEN s.user_id IS NULL THEN NULL ELSE right(s.webhook_url,4) END,'planAllows',public.workspace_has_feature(ws,'webhooks'));
END$$;
REVOKE ALL ON FUNCTION public.set_slack_settings(text,boolean),public.my_slack_settings() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_slack_settings(text,boolean),public.my_slack_settings() TO authenticated;
-- Service role: where to post for this conversation, if Slack is on and the plan allows it.
CREATE FUNCTION public.service_slack_target(p_case_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('url',s.webhook_url,'caseId',c.id)
 FROM support_cases c JOIN slack_settings s ON s.user_id=c.user_id
 WHERE c.token_hash=p_case_hash AND s.enabled AND public.workspace_has_feature(c.user_id,'webhooks')
$$;
REVOKE ALL ON FUNCTION public.service_slack_target(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_slack_target(text) TO service_role;
