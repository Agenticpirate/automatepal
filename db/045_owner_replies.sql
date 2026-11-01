-- 045: Owner replies inside the widget after takeover. Apply ONCE, after 044. Not idempotent.
--
-- Model: after an agent (or higher) takes over a case, they can post a reply that the visitor sees
-- live in the widget (the widget polls). The visitor can answer in the same thread while the case
-- stays taken over. Nothing is emailed. Messages are capped per case, expire with the case link for
-- the visitor, cascade with the case, and are removed by delete_preview_data.

CREATE TABLE public.support_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 author text NOT NULL CHECK(author IN('owner','visitor')),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX support_messages_case_time ON public.support_messages(case_id,created_at);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_messages FROM PUBLIC,anon,authenticated;
-- Read only for workspace members (agent and up). Writes go through the RPCs below.
CREATE POLICY ws_support_messages ON public.support_messages FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
GRANT SELECT ON public.support_messages TO authenticated;

-- Owner-side writes are audited (metadata only); visitor writes are not (record_owner_audit skips them).
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();
CREATE TRIGGER support_messages_actor BEFORE INSERT ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.stamp_actor();

-- Owner reply: agent role, case in the acting workspace, taken over, link not expired, < 100 messages.
-- The ticket history records that a reply was sent, never the reply text.
CREATE FUNCTION public.post_case_reply(p_case uuid,p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();r support_cases;rid uuid;b text:=trim(p_body);
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF b IS NULL OR length(b) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid reply';END IF;
 SELECT * INTO r FROM support_cases WHERE id=p_case AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ticket unavailable';END IF;
 IF r.inbox_state IS DISTINCT FROM 'taken_over' THEN RAISE EXCEPTION 'Take over the conversation first';END IF;
 IF r.expires_at<=now() THEN RAISE EXCEPTION 'Demo link expired';END IF;
 IF(SELECT count(*) FROM support_messages WHERE case_id=p_case)>=100 THEN RAISE EXCEPTION 'Message limit reached';END IF;
 INSERT INTO support_messages(user_id,case_id,author,body) VALUES(uid,p_case,'owner',b) RETURNING id INTO rid;
 UPDATE support_cases SET ticket_updated_at=clock_timestamp(),first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()) WHERE id=p_case;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=p_case)<200 THEN
  INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(uid,p_case,'owner_update','Owner replied in the widget');
 END IF;
 RETURN rid;
END$$;

-- Visitor poll: the case's inbox state plus messages after the cursor (latest 100), unexpired case only.
-- Returns NULL for an unknown or expired link.
CREATE FUNCTION public.support_case_messages(p_hash text,p_after timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('inboxState',c.inbox_state,'messages',coalesce((
  SELECT jsonb_agg(jsonb_build_object('id',m.id,'author',m.author,'body',m.body,'created_at',m.created_at) ORDER BY m.created_at,m.id)
  FROM (SELECT id,author,body,created_at FROM support_messages WHERE case_id=c.id AND (p_after IS NULL OR created_at>p_after) ORDER BY created_at DESC,id DESC LIMIT 100) m
 ),'[]'::jsonb))
 FROM support_cases c WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;

-- Visitor reply: only while taken over, at most 50 visitor messages and 100 messages per case.
CREATE FUNCTION public.support_visitor_message(p_hash text,p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;rid uuid;b text:=trim(p_body);
BEGIN
 IF b IS NULL OR length(b) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid message';END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired demo link';END IF;
 IF c.inbox_state IS DISTINCT FROM 'taken_over' THEN RAISE EXCEPTION 'No person has joined this chat';END IF;
 IF(SELECT count(*) FROM support_messages WHERE case_id=c.id AND author='visitor')>=50 OR(SELECT count(*) FROM support_messages WHERE case_id=c.id)>=100 THEN RAISE EXCEPTION 'Message limit reached';END IF;
 INSERT INTO support_messages(user_id,case_id,author,body) VALUES(c.user_id,c.id,'visitor',b) RETURNING id INTO rid;
 UPDATE support_cases SET ticket_updated_at=clock_timestamp() WHERE id=c.id;
 RETURN rid;
END$$;

REVOKE ALL ON FUNCTION public.post_case_reply(uuid,text),public.support_case_messages(text,timestamptz),public.support_visitor_message(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_case_reply(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_case_messages(text,timestamptz),public.support_visitor_message(text,text) TO anon,authenticated;

-- delete_preview_data: the 044 body plus support_messages (before support_cases).
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
 DELETE FROM demo_webhooks WHERE user_id=uid;
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
