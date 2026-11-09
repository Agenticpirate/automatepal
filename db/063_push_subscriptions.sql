-- Push notifications to the team's phones and computers (Phase 3, mobile inbox). Each signed-in member can
-- subscribe their own devices (Web Push; the browser gives an endpoint and keys). When a visitor asks for a
-- person, a refund review opens or a lead arrives, every subscribed member of that workspace (agent and up)
-- gets a notification with no visitor text: the event, a ticket reference and a link to the ticket.
-- Endpoints are checked against the major push services in the app (lib/web-push.ts); subscriptions that the
-- push service reports gone (404/410) are deleted.
CREATE TABLE public.push_subscriptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE CHECK(endpoint ~ '^https://[^/?#]+/' AND length(endpoint)<=1000),
 p256dh text NOT NULL CHECK(p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
 auth text NOT NULL CHECK(auth ~ '^[A-Za-z0-9_-]{20,30}$'),
 label text CHECK(label IS NULL OR length(label)<=60),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz,
 failures integer NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_workspace ON public.push_subscriptions(workspace_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,workspace_id,user_id,label,created_at,last_success_at) ON public.push_subscriptions TO authenticated;
CREATE POLICY own_push_subscriptions ON public.push_subscriptions FOR SELECT TO authenticated
 USING(user_id=auth.uid() AND workspace_id=(select public.acting_workspace()));

-- Save this device for the signed-in person in the acting workspace (agent and up). 10 devices per person.
CREATE FUNCTION public.save_push_subscription(p_endpoint text,p_p256dh text,p_auth text,p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();rid uuid;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Sign in to a workspace first';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,63));
 IF(SELECT count(*) FROM push_subscriptions WHERE user_id=auth.uid() AND endpoint<>p_endpoint)>=10 THEN RAISE EXCEPTION 'Ten devices maximum. Turn notifications off on one first.';END IF;
 INSERT INTO push_subscriptions(workspace_id,user_id,endpoint,p256dh,auth,label) VALUES(ws,auth.uid(),p_endpoint,p_p256dh,p_auth,left(p_label,60))
  ON CONFLICT(endpoint) DO UPDATE SET workspace_id=excluded.workspace_id,user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,label=excluded.label,failures=0
  RETURNING id INTO rid;
 RETURN rid;
END$$;
CREATE FUNCTION public.delete_push_subscription(p_endpoint text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM push_subscriptions WHERE endpoint=p_endpoint AND user_id=auth.uid();
 RETURN FOUND;
END$$;
-- The signed-in person's own devices in the acting workspace, with keys, for a test notification.
CREATE FUNCTION public.my_push_targets() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'endpoint',endpoint,'p256dh',p256dh,'auth',auth)),'[]'::jsonb)
 FROM push_subscriptions WHERE user_id=auth.uid() AND workspace_id=public.acting_workspace()
$$;
REVOKE ALL ON FUNCTION public.save_push_subscription(text,text,text,text),public.delete_push_subscription(text),public.my_push_targets() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text,text,text,text),public.delete_push_subscription(text),public.my_push_targets() TO authenticated;

-- Service role: devices to notify for a conversation (members who are still agent and up, and the owner).
CREATE FUNCTION public.service_push_targets(p_case_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('caseId',c.id,'targets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth))
   FROM push_subscriptions s WHERE s.workspace_id=c.user_id
    AND (s.user_id=c.user_id OR EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=c.user_id AND m.user_id=s.user_id AND public.role_rank(m.role)>=1))
    AND s.failures<10),'[]'::jsonb))
 FROM support_cases c WHERE c.token_hash=p_case_hash
$$;
-- Service role: record a send. 404/410 delete the subscription; other failures count up (10 stop sends).
CREATE FUNCTION public.service_push_result(p_id uuid,p_status integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_status IN(404,410) THEN DELETE FROM push_subscriptions WHERE id=p_id;
 ELSIF p_status BETWEEN 200 AND 299 THEN UPDATE push_subscriptions SET failures=0,last_success_at=now() WHERE id=p_id;
 ELSE UPDATE push_subscriptions SET failures=failures+1 WHERE id=p_id;END IF;
END$$;
REVOKE ALL ON FUNCTION public.service_push_targets(text),public.service_push_result(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_push_targets(text),public.service_push_result(uuid,integer) TO service_role;

-- Preview-data deletion also removes this workspace's device subscriptions (as 062, plus that line).
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
 DELETE FROM insight_settings WHERE user_id=uid;
 DELETE FROM conversation_insights WHERE user_id=uid;
 DELETE FROM widget_opens WHERE user_id=uid;
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
 DELETE FROM bots WHERE workspace_id=uid;
 DELETE FROM slack_settings WHERE user_id=uid;
 DELETE FROM push_subscriptions WHERE workspace_id=uid;
 DELETE FROM proof_contracts WHERE user_id=uid;
 DELETE FROM action_proposals WHERE user_id=uid;
 DELETE FROM billing_events WHERE user_id=uid;
 DELETE FROM owner_audit_events WHERE user_id=uid;
 DELETE FROM workspace_invites WHERE workspace_id=uid;
 DELETE FROM workspace_members WHERE workspace_id=uid;
 RETURN true;
END;
$function$;
