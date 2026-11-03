-- 051: AI conversation insights and widget-open counts. Apply ONCE, after 050. Not idempotent.
--
-- Model: the scheduled job labels finished conversations in small batches with a low-cost model: one topic
-- from the workspace's own list (or 'other'), a sentiment and an outcome (resolved, unresolved, escalated).
-- Labels are stored per conversation and replaced when the conversation has new activity. The batch spends
-- inside LLM_DAILY_USD_CAP and stops early, so it never takes the budget chat answers need. Managers and up
-- edit the topic list (1-12 names) or turn labelling off. widget_opens counts how often the widget or the
-- hosted help page was opened per conversation, source and UTC day (for the engagement funnel).

CREATE TABLE public.insight_settings(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 topics jsonb NOT NULL DEFAULT '["Billing","Shipping","Refunds","Account","Product","Technical issue"]'::jsonb,
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(jsonb_typeof(topics)='array' AND jsonb_array_length(topics) BETWEEN 1 AND 12)
);
ALTER TABLE public.insight_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.insight_settings FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_insight_settings ON public.insight_settings FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
GRANT SELECT ON public.insight_settings TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.insight_settings FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();

CREATE FUNCTION public.default_insight_topics() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT '["Billing","Shipping","Refunds","Account","Product","Technical issue"]'::jsonb
$$;
GRANT EXECUTE ON FUNCTION public.default_insight_topics() TO authenticated;

-- Managers and up. Topic names: 2-40 characters of letters, digits, spaces and & / - ' , . ( ), no
-- duplicates (case-insensitive), not 'other' (always available).
CREATE FUNCTION public.set_insight_settings(p_topics jsonb,p_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();t jsonb;
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_enabled IS NULL OR p_topics IS NULL OR jsonb_typeof(p_topics)<>'array' OR jsonb_array_length(p_topics) NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Give 1 to 12 topics';END IF;
 FOR t IN SELECT jsonb_array_elements(p_topics) LOOP
  IF jsonb_typeof(t)<>'string' OR char_length(t#>>'{}') NOT BETWEEN 2 AND 40 OR (t#>>'{}')!~'^[[:alnum:]][[:alnum:] &/''(),.-]*$' OR lower(t#>>'{}')='other' THEN RAISE EXCEPTION 'Invalid topic name';END IF;
 END LOOP;
 IF(SELECT count(DISTINCT lower(x)) FROM jsonb_array_elements_text(p_topics) x)<>jsonb_array_length(p_topics) THEN RAISE EXCEPTION 'Duplicate topic name';END IF;
 INSERT INTO insight_settings(user_id,topics,enabled) VALUES(uid,p_topics,p_enabled)
  ON CONFLICT(user_id) DO UPDATE SET topics=EXCLUDED.topics,enabled=EXCLUDED.enabled,updated_at=clock_timestamp();
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.set_insight_settings(jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_insight_settings(jsonb,boolean) TO authenticated;

CREATE TABLE public.conversation_insights(
 case_id uuid PRIMARY KEY REFERENCES public.support_cases(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 topic text NOT NULL CHECK(char_length(topic) BETWEEN 2 AND 40),
 sentiment text NOT NULL CHECK(sentiment IN('positive','neutral','negative')),
 outcome text NOT NULL CHECK(outcome IN('resolved','unresolved','escalated')),
 activity_at timestamptz NOT NULL,
 labeled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 model text NOT NULL CHECK(model ~ '^[A-Za-z0-9._-]{1,60}$')
);
CREATE INDEX conversation_insights_ws_time ON public.conversation_insights(user_id,labeled_at DESC);
ALTER TABLE public.conversation_insights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_insights FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_conversation_insights ON public.conversation_insights FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
GRANT SELECT ON public.conversation_insights TO authenticated;

-- Service role: up to p_limit (1-25) conversations to label. A conversation is ready when it has at least
-- one question, its last activity is 30 minutes to 30 days old, labelling is on for its workspace, and it
-- has no label for that activity yet. Each item carries at most 12 question/answer turns (each cut to
-- 300 characters), the visitor's request kinds and the ticket state; no contact details.
CREATE FUNCTION public.service_insights_pending(p_limit integer) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'activityAt'),'[]'::jsonb) FROM (
  SELECT jsonb_build_object('caseId',c.id,'workspace',c.user_id,'activityAt',a.at,
   'topics',coalesce(s.topics,public.default_insight_topics()),
   'inboxState',c.inbox_state,'ticketStatus',c.ticket_status,
   'requests',coalesce((SELECT jsonb_agg(DISTINCT r.kind) FROM support_requests r WHERE r.case_id=c.id),'[]'::jsonb),
   'turns',(SELECT coalesce(jsonb_agg(jsonb_build_object('q',left(i.question,300),'a',left(coalesce(i.answer,''),300),'supported',i.supported,'feedback',i.feedback) ORDER BY i.created_at),'[]'::jsonb)
     FROM (SELECT * FROM knowledge_interactions WHERE case_id=c.id ORDER BY created_at LIMIT 12) i)) x
  FROM support_cases c
  CROSS JOIN LATERAL (SELECT public.case_last_activity(c.id) at) a
  LEFT JOIN insight_settings s ON s.user_id=c.user_id
  LEFT JOIN conversation_insights ci ON ci.case_id=c.id
  WHERE coalesce(s.enabled,true)
   AND EXISTS(SELECT 1 FROM knowledge_interactions k WHERE k.case_id=c.id)
   AND a.at<now()-interval '30 minutes' AND a.at>now()-interval '30 days'
   AND (ci.case_id IS NULL OR ci.activity_at<a.at)
  ORDER BY a.at LIMIT least(greatest(coalesce(p_limit,10),1),25)) q
$$;
-- Service role: store labels. A topic outside the workspace list becomes 'other'. Returns rows written.
CREATE FUNCTION public.service_insights_record(p_items jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE it jsonb;n integer:=0;c support_cases;topics jsonb;tp text;
BEGIN
 IF jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Invalid insights';END IF;
 FOR it IN SELECT jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LIMIT 25 LOOP
  SELECT * INTO c FROM support_cases WHERE id=(it->>'caseId')::uuid;
  IF NOT FOUND OR it->>'sentiment' NOT IN('positive','neutral','negative') OR it->>'outcome' NOT IN('resolved','unresolved','escalated') OR (it->>'activityAt') IS NULL THEN CONTINUE;END IF;
  SELECT coalesce((SELECT s.topics FROM insight_settings s WHERE s.user_id=c.user_id),public.default_insight_topics()) INTO topics;
  SELECT x INTO tp FROM jsonb_array_elements_text(topics) x WHERE lower(x)=lower(btrim(it->>'topic')) LIMIT 1;
  INSERT INTO conversation_insights(case_id,user_id,topic,sentiment,outcome,activity_at,model)
   VALUES(c.id,c.user_id,coalesce(tp,'other'),it->>'sentiment',it->>'outcome',(it->>'activityAt')::timestamptz,left(coalesce(nullif(it->>'model',''),'unknown'),60))
   ON CONFLICT(case_id) DO UPDATE SET topic=EXCLUDED.topic,sentiment=EXCLUDED.sentiment,outcome=EXCLUDED.outcome,activity_at=EXCLUDED.activity_at,labeled_at=clock_timestamp(),model=EXCLUDED.model;
  n:=n+1;
 END LOOP;
 RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.service_insights_pending(integer),public.service_insights_record(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_insights_pending(integer),public.service_insights_record(jsonb) TO service_role;

-- Widget opens per conversation, source and UTC day.
CREATE TABLE public.widget_opens(
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 day date NOT NULL,
 source text NOT NULL CHECK(source IN('widget','hosted_page')),
 opens integer NOT NULL DEFAULT 1 CHECK(opens BETWEEN 1 AND 10000),
 PRIMARY KEY(case_id,day,source)
);
CREATE INDEX widget_opens_ws_day ON public.widget_opens(user_id,day DESC);
ALTER TABLE public.widget_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.widget_opens FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_widget_opens ON public.widget_opens FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
GRANT SELECT ON public.widget_opens TO authenticated;
-- Visitor side (case link): count one open. Unexpired link only; saturates at 10000 per day and source.
CREATE FUNCTION public.support_record_open(p_hash text,p_source text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;
BEGIN
 IF coalesce(p_source,'') NOT IN('widget','hosted_page') THEN RETURN false;END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now();
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO widget_opens(case_id,user_id,day,source) VALUES(c.id,c.user_id,(now() AT TIME ZONE 'UTC')::date,p_source)
  ON CONFLICT(case_id,day,source) DO UPDATE SET opens=least(widget_opens.opens+1,10000);
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.support_record_open(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_record_open(text,text) TO anon,authenticated;

-- delete_preview_data: the 050 body plus insights and opens (before support_cases).
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
 DELETE FROM proof_contracts WHERE user_id=uid;
 DELETE FROM action_proposals WHERE user_id=uid;
 DELETE FROM billing_events WHERE user_id=uid;
 DELETE FROM owner_audit_events WHERE user_id=uid;
 DELETE FROM workspace_invites WHERE workspace_id=uid;
 DELETE FROM workspace_members WHERE workspace_id=uid;
 RETURN true;
END;
$function$;
