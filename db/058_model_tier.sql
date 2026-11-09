-- Fast or deep answers (Phase 3). The owner picks controls.modelTier ('fast' default, or 'deep') in Widget
-- studio. Deep runs the answer on a larger model (lib/llm.ts tier 'deep') and counts 10 against the monthly
-- AI-answer allowance, like SiteGPT's larger model. Deep is available on paid plans; on Free it falls back to
-- fast. The effective tier is decided here once and reported in the visitor view, so the API call and the
-- quota always agree.
ALTER TABLE public.knowledge_interactions ADD COLUMN model_tier text NOT NULL DEFAULT 'fast' CHECK(model_tier IN('fast','deep'));
ALTER TABLE public.knowledge_interactions ADD COLUMN weight smallint NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 10);

CREATE FUNCTION public.effective_model_tier(p_ws uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN (SELECT controls->>'modelTier' FROM widget_settings WHERE user_id=p_ws)='deep' AND public.workspace_plan(p_ws)<>'free' THEN 'deep' ELSE 'fast' END
$$;
REVOKE ALL ON FUNCTION public.effective_model_tier(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.effective_model_tier(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.support_case_view(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT public.support_case_view_base(p_hash)||jsonb_build_object('controls',coalesce(s.controls,'{}'::jsonb),'inboxState',c.inbox_state,'modelTier',public.effective_model_tier(c.user_id))
 FROM support_cases c LEFT JOIN widget_settings s ON s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;

-- As in 057, plus the tier and its weight; the monthly allowance counts weights.
CREATE OR REPLACE FUNCTION public.support_reserve_knowledge(p_hash text,p_question text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;cap integer:=20;ctl jsonb;tier text;w smallint;
BEGIN
 IF p_question IS NULL OR length(trim(p_question)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid question';END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RAISE EXCEPTION 'AI paused: case taken over, closed or expired';END IF;
 SELECT controls INTO ctl FROM widget_settings WHERE user_id=c.user_id;
 IF jsonb_typeof(ctl->'maxQuestions')='number' THEN cap:=least(greatest(floor((ctl->>'maxQuestions')::numeric)::integer,1),50);END IF;
 tier:=public.effective_model_tier(c.user_id);w:=CASE WHEN tier='deep' THEN 10 ELSE 1 END;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,0));
 IF(SELECT count(*) FROM knowledge_interactions WHERE case_id=c.id)>=cap THEN RAISE EXCEPTION 'Conversation question limit reached';END IF;
 IF(SELECT coalesce(sum(weight),0) FROM knowledge_interactions WHERE user_id=c.user_id AND created_at>=date_trunc('month',now()))+w>(public.workspace_limits(c.user_id)->>'messages')::int THEN RAISE EXCEPTION 'Monthly message limit reached';END IF;
 INSERT INTO knowledge_interactions(user_id,case_id,question,supported,source_count,model_tier,weight) VALUES(c.user_id,c.id,p_question,false,0,tier,w) RETURNING id INTO rid;RETURN rid;
END;
$$;

-- my_plan usage counts weights and reports the effective tier.
CREATE OR REPLACE FUNCTION public.my_plan()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ws uuid:=public.acting_workspace();s workspace_subscriptions;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('agent') THEN RETURN NULL;END IF;
 SELECT * INTO s FROM workspace_subscriptions WHERE workspace_id=ws;
 RETURN jsonb_build_object(
  'plan',public.workspace_plan(ws),'modelTier',public.effective_model_tier(ws),'role',public.acting_role(),'limits',public.workspace_limits(ws),
  'subscription',CASE WHEN s.workspace_id IS NULL THEN NULL ELSE jsonb_build_object('provider',s.provider,'plan',s.plan_key,'interval',s.billing_interval,'status',s.status,'periodEnd',s.current_period_end,'graceUntil',s.grace_until) END,
  'usage',jsonb_build_object(
   'messages',(SELECT coalesce(sum(weight),0) FROM knowledge_interactions WHERE user_id=ws AND created_at>=date_trunc('month',now())),
   'sources',(SELECT count(*) FROM knowledge_documents WHERE user_id=ws),
   'pages',(SELECT coalesce(sum(ceil(length(content)::numeric/2500)),0)::int FROM knowledge_documents WHERE user_id=ws),
   'seats',public.workspace_seat_count(ws)),
  'monthStart',date_trunc('month',now()));
END$function$;
