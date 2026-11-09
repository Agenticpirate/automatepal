-- Plans and subscriptions (Phase 2). A workspace's plan comes from its row in workspace_subscriptions (PayPal,
-- or 'manual' for comps), else 'free'. Limits live in plan_limits(), mirrored in lib/plans.ts
-- (scripts/verify-plans.ts checks they match). The existing quota checks now read the plan instead of fixed
-- preview numbers: sources and pages (save_knowledge_source, mcp_add_knowledge_source), seats
-- (create_workspace_invite), AI answers per calendar month (support_reserve_knowledge) and the limits MCP
-- reports. Writes to subscriptions are service-role only (app/api/billing/plan, app/api/paypal/webhook).

CREATE TABLE public.workspace_subscriptions(
 workspace_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN('paypal','manual')),
 provider_subscription_id text UNIQUE CHECK(provider_subscription_id IS NULL OR provider_subscription_id ~ '^I-[A-Z0-9]{6,40}$'),
 plan_key text NOT NULL CHECK(plan_key IN('starter','growth','scale','enterprise')),
 billing_interval text CHECK(billing_interval IN('month','year')),
 status text NOT NULL CHECK(status IN('approval_pending','active','suspended','cancelled','expired')),
 current_period_end timestamptz,
 grace_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((provider='paypal')=(provider_subscription_id IS NOT NULL)),
 CHECK(plan_key<>'enterprise' OR provider='manual')
);
ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_subscriptions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.workspace_subscriptions TO authenticated;
CREATE POLICY ws_subscription_read ON public.workspace_subscriptions FOR SELECT TO authenticated
 USING(workspace_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));

-- PayPal webhook events already handled (idempotency). Ids only, no payloads.
CREATE TABLE public.paypal_webhook_events(
 event_id text PRIMARY KEY CHECK(event_id ~ '^[A-Za-z0-9-]{6,80}$'),
 event_type text NOT NULL CHECK(length(event_type)<=80),
 subscription_id text CHECK(subscription_id IS NULL OR length(subscription_id)<=60),
 outcome text NOT NULL CHECK(outcome IN('synced','ignored','failed')),
 received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paypal_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paypal_webhook_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.plan_limits(p_plan text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_plan
  WHEN 'starter' THEN '{"plan":"starter","messages":4000,"pages":1000,"sources":1000,"seats":1,"bots":1,"refresh":"manual","features":[]}'
  WHEN 'growth' THEN '{"plan":"growth","messages":10000,"pages":10000,"sources":10000,"seats":4,"bots":2,"refresh":"monthly","features":["api","webhooks","billing_support","scheduled_refresh"]}'
  WHEN 'scale' THEN '{"plan":"scale","messages":40000,"pages":50000,"sources":50000,"seats":10,"bots":3,"refresh":"weekly","features":["api","webhooks","mcp","billing_support","insights","scheduled_refresh"]}'
  WHEN 'enterprise' THEN '{"plan":"enterprise","messages":1000000,"pages":500000,"sources":500000,"seats":1000,"bots":1000,"refresh":"daily","features":["api","webhooks","mcp","billing_support","insights","scheduled_refresh"]}'
  ELSE '{"plan":"free","messages":100,"pages":50,"sources":50,"seats":1,"bots":1,"refresh":"manual","features":[]}'
 END::jsonb
$$;
-- Effective plan: active; or suspended within its grace period; or cancelled until the paid period ends.
CREATE FUNCTION public.workspace_plan(p_ws uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT plan_key FROM workspace_subscriptions WHERE workspace_id=p_ws AND (
   status='active'
   OR (status='suspended' AND grace_until>now())
   OR (status='cancelled' AND current_period_end>now()))),'free')
$$;
CREATE FUNCTION public.workspace_limits(p_ws uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.plan_limits(public.workspace_plan(p_ws))
$$;
REVOKE ALL ON FUNCTION public.workspace_plan(uuid),public.workspace_limits(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.plan_limits(text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workspace_plan(uuid),public.workspace_limits(uuid) TO service_role;

-- Plan, subscription and usage for the acting workspace (agent and up), for the Plan page and plan gates.
CREATE FUNCTION public.my_plan() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();s workspace_subscriptions;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('agent') THEN RETURN NULL;END IF;
 SELECT * INTO s FROM workspace_subscriptions WHERE workspace_id=ws;
 RETURN jsonb_build_object(
  'plan',public.workspace_plan(ws),'role',public.acting_role(),'limits',public.workspace_limits(ws),
  'subscription',CASE WHEN s.workspace_id IS NULL THEN NULL ELSE jsonb_build_object('provider',s.provider,'plan',s.plan_key,'interval',s.billing_interval,'status',s.status,'periodEnd',s.current_period_end,'graceUntil',s.grace_until) END,
  'usage',jsonb_build_object(
   'messages',(SELECT count(*) FROM knowledge_interactions WHERE user_id=ws AND created_at>=date_trunc('month',now())),
   'sources',(SELECT count(*) FROM knowledge_documents WHERE user_id=ws),
   'pages',(SELECT coalesce(sum(ceil(length(content)::numeric/2500)),0)::int FROM knowledge_documents WHERE user_id=ws),
   'seats',public.workspace_seat_count(ws)),
  'monthStart',date_trunc('month',now()));
END$$;
REVOKE ALL ON FUNCTION public.my_plan() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated;

-- Service role: write the subscription PayPal reports (after the server re-read it from PayPal).
-- A suspended subscription gets a 7-day grace period from the first suspension; becoming active clears it.
CREATE FUNCTION public.sync_paypal_subscription(p_ws uuid,p_subscription text,p_plan text,p_interval text,p_status text,p_period_end timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prev workspace_subscriptions;r workspace_subscriptions;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_ws) THEN RAISE EXCEPTION 'Unknown workspace';END IF;
 SELECT * INTO prev FROM workspace_subscriptions WHERE workspace_id=p_ws FOR UPDATE;
 -- A late event for an older subscription must not overwrite the current one.
 IF prev.workspace_id IS NOT NULL AND prev.provider='paypal' AND prev.provider_subscription_id<>p_subscription AND prev.status IN('active','suspended','approval_pending') AND p_status IN('cancelled','expired') THEN
  RETURN jsonb_build_object('ignored','older subscription');
 END IF;
 INSERT INTO workspace_subscriptions AS w(workspace_id,provider,provider_subscription_id,plan_key,billing_interval,status,current_period_end,grace_until,updated_at)
  VALUES(p_ws,'paypal',p_subscription,p_plan,p_interval,p_status,p_period_end,CASE WHEN p_status='suspended' THEN now()+interval '7 days' END,now())
  ON CONFLICT(workspace_id) DO UPDATE SET provider='paypal',provider_subscription_id=excluded.provider_subscription_id,plan_key=excluded.plan_key,billing_interval=excluded.billing_interval,status=excluded.status,
   current_period_end=coalesce(excluded.current_period_end,CASE WHEN w.provider_subscription_id=excluded.provider_subscription_id THEN w.current_period_end END),
   grace_until=CASE WHEN excluded.status='suspended' THEN coalesce(CASE WHEN w.status='suspended' THEN w.grace_until END,now()+interval '7 days') END,
   updated_at=now()
  RETURNING * INTO r;
 RETURN jsonb_build_object('plan',public.workspace_plan(p_ws),'status',r.status);
END$$;
-- Service role: comp a workspace (no PayPal), or remove a comp by passing NULL.
CREATE FUNCTION public.set_manual_plan(p_ws uuid,p_plan text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_plan IS NULL THEN DELETE FROM workspace_subscriptions WHERE workspace_id=p_ws AND provider='manual';RETURN public.workspace_plan(p_ws);END IF;
 INSERT INTO workspace_subscriptions(workspace_id,provider,plan_key,status) VALUES(p_ws,'manual',p_plan,'active')
  ON CONFLICT(workspace_id) DO UPDATE SET provider='manual',provider_subscription_id=NULL,plan_key=excluded.plan_key,billing_interval=NULL,status='active',current_period_end=NULL,grace_until=NULL,updated_at=now();
 RETURN public.workspace_plan(p_ws);
END$$;
-- Service role: record a webhook event id once; false when it was already handled.
CREATE FUNCTION public.record_paypal_event(p_id text,p_type text,p_subscription text,p_outcome text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO paypal_webhook_events(event_id,event_type,subscription_id,outcome) VALUES(p_id,p_type,p_subscription,p_outcome);
 DELETE FROM paypal_webhook_events WHERE received_at<now()-interval '90 days';
 RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END$$;
CREATE FUNCTION public.paypal_event_seen(p_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM paypal_webhook_events WHERE event_id=p_id AND outcome<>'failed')
$$;
REVOKE ALL ON FUNCTION public.sync_paypal_subscription(uuid,text,text,text,text,timestamptz),public.set_manual_plan(uuid,text),public.record_paypal_event(text,text,text,text),public.paypal_event_seen(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_paypal_subscription(uuid,text,text,text,text,timestamptz),public.set_manual_plan(uuid,text),public.record_paypal_event(text,text,text,text),public.paypal_event_seen(text) TO service_role;

-- AI answers per calendar month from the plan (replaces the preview's 100 per UTC day). Otherwise as in 055.
CREATE OR REPLACE FUNCTION public.support_reserve_knowledge(p_hash text,p_question text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;cap integer:=20;ctl jsonb;
BEGIN
 IF p_question IS NULL OR length(trim(p_question)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid question';END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RAISE EXCEPTION 'AI paused: case taken over, closed or expired';END IF;
 SELECT controls INTO ctl FROM widget_settings WHERE user_id=c.user_id;
 IF jsonb_typeof(ctl->'maxQuestions')='number' THEN cap:=least(greatest(floor((ctl->>'maxQuestions')::numeric)::integer,1),50);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,0));
 IF(SELECT count(*) FROM knowledge_interactions WHERE case_id=c.id)>=cap THEN RAISE EXCEPTION 'Conversation question limit reached';END IF;
 IF(SELECT count(*) FROM knowledge_interactions WHERE user_id=c.user_id AND created_at>=date_trunc('month',now()))>=(public.workspace_limits(c.user_id)->>'messages')::int THEN RAISE EXCEPTION 'Monthly message limit reached';END IF;
 INSERT INTO knowledge_interactions(user_id,case_id,question,supported,source_count) VALUES(c.user_id,c.id,p_question,false,0) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE INDEX IF NOT EXISTS knowledge_interactions_ws_month ON public.knowledge_interactions(user_id,created_at);

-- Existing quota functions, unchanged except that they read the plan (definitions as of 056).
CREATE OR REPLACE FUNCTION public.save_knowledge_source(p_id uuid, p_expected timestamp with time zone, p_title text, p_content text, p_published boolean, p_chunks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE uid uuid:=public.acting_workspace();existing public.knowledge_documents;pages integer;cnt integer;item jsonb;pos integer:=0;lim jsonb;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 IF length(p_title) NOT BETWEEN 3 AND 120 OR length(p_content) NOT BETWEEN 20 AND 30000 OR p_published IS NULL OR jsonb_typeof(p_chunks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid source';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 SELECT * INTO existing FROM public.knowledge_documents WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF existing.user_id<>uid OR p_expected IS NULL OR existing.updated_at<>p_expected THEN RAISE EXCEPTION 'Source changed or unavailable. Reload before editing';END IF;
 ELSIF p_expected IS NOT NULL THEN RAISE EXCEPTION 'Source changed or unavailable. Reload before editing';END IF;
 SELECT count(*),coalesce(sum(ceil(length(content)::numeric/2500)),0) INTO cnt,pages FROM public.knowledge_documents WHERE user_id=uid AND id<>p_id;
 lim:=public.workspace_limits(uid);
 IF cnt>=(lim->>'sources')::int OR pages+ceil(length(p_content)::numeric/2500)>(lim->>'pages')::int THEN RAISE EXCEPTION 'Plan limit reached: % sources or % pages. Upgrade your plan for more.',lim->>'sources',lim->>'pages';END IF;
 INSERT INTO public.knowledge_documents(id,user_id,title,content,published,updated_at) VALUES(p_id,uid,p_title,p_content,p_published,clock_timestamp()) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,published=excluded.published,updated_at=excluded.updated_at;
 DELETE FROM public.knowledge_chunks WHERE document_id=p_id AND user_id=uid;
 FOR item IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP
  IF jsonb_typeof(item->'embedding') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'embedding')<>768 OR length(item->>'content') NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'Invalid chunks';END IF;
  INSERT INTO public.knowledge_chunks(id,document_id,user_id,position,content,embedding) VALUES(gen_random_uuid(),p_id,uid,pos,item->>'content',(item->'embedding')::text::extensions.vector(768));pos:=pos+1;
 END LOOP;
 RETURN p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_add_knowledge_source(p_hash text, p_title text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t readonly_tokens;uid uuid;rid uuid:=gen_random_uuid();cnt integer;pages numeric;ti text:=btrim(p_title);co text:=btrim(p_content);lim jsonb;
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF NOT public.mcp_tool_allowed(t.scope,'add_text_knowledge_source') THEN PERFORM public.mcp_log(uid,t.id,'add_text_knowledge_source','refused');RETURN jsonb_build_object('refused',true);END IF;
 IF ti IS NULL OR co IS NULL OR length(ti) NOT BETWEEN 3 AND 120 OR length(co) NOT BETWEEN 20 AND 20000 THEN
  PERFORM public.mcp_log(uid,t.id,'add_text_knowledge_source','error');RETURN jsonb_build_object('invalid','Title must be 3 to 120 characters and content 20 to 20000 characters.');
 END IF;
 -- Same lock as knowledge saves (quota), then the MCP lock (daily cap).
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,46));
 IF public.mcp_used_today(uid,'add_text_knowledge_source')>=10 THEN PERFORM public.mcp_log(uid,t.id,'add_text_knowledge_source','budget');RETURN jsonb_build_object('budget',true,'limit',10);END IF;
 SELECT count(*),coalesce(sum(ceil(length(content)::numeric/2500)),0) INTO cnt,pages FROM knowledge_documents WHERE user_id=uid;
 lim:=public.workspace_limits(uid);
 IF cnt>=(lim->>'sources')::int OR pages+ceil(length(co)::numeric/2500)>(lim->>'pages')::int THEN
  PERFORM public.mcp_log(uid,t.id,'add_text_knowledge_source','budget');RETURN jsonb_build_object('budget',true,'quota','Plan limit reached: '||(lim->>'sources')||' sources or '||(lim->>'pages')||' pages.');
 END IF;
 INSERT INTO knowledge_documents(id,user_id,title,content,published,pending_approval,proposed_by_token,updated_at) VALUES(rid,uid,ti,co,false,true,t.id,clock_timestamp());
 -- Owner audit row (metadata only). The table trigger only logs signed-in workspace writes, so add it here.
 IF public.acting_workspace() IS DISTINCT FROM uid THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,42));
  DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 999);
  INSERT INTO owner_audit_events(user_id,resource,operation,resource_id) VALUES(uid,'knowledge_documents','INSERT',rid);
 END IF;
 PERFORM public.mcp_log(uid,t.id,'add_text_knowledge_source','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('id',rid,'published',false,'pendingApproval',true));
END$function$;

CREATE OR REPLACE FUNCTION public.create_workspace_invite(p_email text, p_role text, p_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ws uuid:=public.acting_workspace();me text:=public.acting_role();e text:=lower(trim(p_email));rid uuid;
BEGIN
 IF ws IS NULL OR p_role NOT IN('admin','manager','agent') OR public.role_rank(p_role)>=public.role_rank(me) THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF e IS NULL OR e!~'^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(e)>254 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid invite';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws::text,43));
 IF EXISTS(SELECT 1 FROM auth.users u WHERE u.id=ws AND lower(u.email)=e) OR EXISTS(SELECT 1 FROM workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=ws AND lower(u.email)=e) THEN RAISE EXCEPTION 'Already a member';END IF;
 IF EXISTS(SELECT 1 FROM workspace_invites WHERE workspace_id=ws AND email=e AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Invite already pending';END IF;
 UPDATE workspace_invites SET revoked_at=now() WHERE workspace_id=ws AND email=e AND accepted_at IS NULL AND revoked_at IS NULL;
 IF public.workspace_seat_count(ws)>=(public.workspace_limits(ws)->>'seats')::int THEN RAISE EXCEPTION 'Seat limit reached for your plan';END IF;
 INSERT INTO workspace_invites(workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(ws,e,p_role,p_hash,auth.uid(),now()+interval '7 days') RETURNING id INTO rid;
 PERFORM public.audit_team(ws,'workspace_invites','INSERT',rid);
 RETURN rid;
END$function$;

CREATE OR REPLACE FUNCTION public.mcp_read_data(p_hash text, p_tool text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t readonly_tokens;uid uuid;r jsonb;day0 timestamptz:=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF p_tool IS NULL OR p_tool NOT IN('knowledge_sources','tickets','unanswered','overview','billing_status') OR NOT public.mcp_tool_allowed(t.scope,p_tool) THEN
  PERFORM public.mcp_log(uid,t.id,coalesce(p_tool,'unknown'),'refused');RETURN jsonb_build_object('refused',true);
 END IF;
 IF p_tool='knowledge_sources' THEN
  -- Metadata only, never the source text.
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO r FROM(
   SELECT id,title,source_kind,published,pending_approval,(proposed_by_token IS NOT NULL) AS proposed_via_mcp,created_at,updated_at,
    length(content) AS characters,ceil(length(content)::numeric/2500)::int AS page_units
   FROM knowledge_documents WHERE user_id=uid ORDER BY created_at DESC LIMIT 31)x;
  r:=jsonb_build_object('sources',r,'sourceLimit',(public.workspace_limits(uid)->>'sources')::int,'pageLimit',(public.workspace_limits(uid)->>'pages')::int);
 ELSIF p_tool='tickets' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.ticket_updated_at DESC),'[]'::jsonb) INTO r FROM(
   SELECT id,created_at,ticket_updated_at,order_label,ticket_status,priority,category,inbox_state,assigned_to_owner,(assignee_id IS NOT NULL) AS assigned,(expires_at<=now()) AS link_expired
   FROM support_cases WHERE user_id=uid ORDER BY ticket_updated_at DESC LIMIT 100)x;
  r:=jsonb_build_object('tickets',r,'limit',100);
 ELSIF p_tool='unanswered' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO r FROM(
   SELECT id,created_at,question,supported,feedback FROM knowledge_interactions
   WHERE user_id=uid AND NOT supported AND created_at>=now()-interval '7 days' ORDER BY created_at DESC LIMIT 200)x;
  r:=jsonb_build_object('rows',r,'limit',200);
 ELSIF p_tool='overview' THEN
  r:=jsonb_build_object('asOf',now(),
   'tickets',(SELECT jsonb_build_object('total',count(*),'new',count(*) FILTER(WHERE ticket_status='new'),'open',count(*) FILTER(WHERE ticket_status='open'),
     'pending',count(*) FILTER(WHERE ticket_status='pending'),'resolved',count(*) FILTER(WHERE ticket_status='resolved'),'closed',count(*) FILTER(WHERE ticket_status='closed'),
     'takenOver',count(*) FILTER(WHERE inbox_state='taken_over'),'needsAttention',count(*) FILTER(WHERE inbox_state='attention'),
     'urgentOrHighOpen',count(*) FILTER(WHERE priority IN('urgent','high') AND ticket_status NOT IN('resolved','closed'))) FROM support_cases WHERE user_id=uid),
   'questions',(SELECT jsonb_build_object('todayUtc',count(*) FILTER(WHERE created_at>=day0),'last7Days',count(*) FILTER(WHERE created_at>=now()-interval '7 days'),
     'unanswered7Days',count(*) FILTER(WHERE NOT supported AND created_at>=now()-interval '7 days'),'negativeFeedback7Days',count(*) FILTER(WHERE feedback=-1 AND created_at>=now()-interval '7 days'),
     'dailyAnswerLimit',100) FROM knowledge_interactions WHERE user_id=uid),
   'requests',(SELECT jsonb_build_object('total',count(*),'pendingReview',count(*) FILTER(WHERE status='pending_review')) FROM support_requests WHERE user_id=uid),
   'knowledge',(SELECT jsonb_build_object('sources',count(*),'published',count(*) FILTER(WHERE published),'pendingApproval',count(*) FILTER(WHERE pending_approval),
     'pageUnits',coalesce(sum(ceil(length(content)::numeric/2500)),0)::int,'sourceLimit',(public.workspace_limits(uid)->>'sources')::int,'pageLimit',(public.workspace_limits(uid)->>'pages')::int) FROM knowledge_documents WHERE user_id=uid),
   'coverage','SQL counts over this workspace. UTC days. No customer reply metric or SLA.');
 ELSE
  -- billing_status: no ciphertext, proof hash, key hint, account label or config. key_id is the encryption
  -- key label (e.g. k1); the server turns it into a needs-rotation flag and drops it.
  SELECT coalesce(jsonb_agg(jsonb_build_object('provider',b.provider,'mode',b.mode,'status',b.status,'last_checked_at',b.last_checked_at,'key_id',b.key_id,
    'lookups24h',coalesce((SELECT jsonb_object_agg(o.outcome,o.n) FROM(SELECT l.outcome,count(*) n FROM billing_lookups l WHERE l.user_id=uid AND l.provider=b.provider AND l.created_at>now()-interval '24 hours' GROUP BY l.outcome)o),'{}'::jsonb)
   ) ORDER BY b.provider),'[]'::jsonb) INTO r FROM billing_connections b WHERE b.user_id=uid;
  r:=jsonb_build_object('connections',r);
 END IF;
 PERFORM public.mcp_log(uid,t.id,p_tool,'ok');
 RETURN jsonb_build_object('ok',true,'data',r);
END$function$;

-- Plan feature gates where a signed-in client could otherwise call the function directly: API and MCP
-- tokens, webhooks, scheduled refresh frequency; and in the scheduled jobs that pick workspaces (refresh,
-- AI insights). Billing-provider connections need a server-only proof (044), so their gate is in the API.
CREATE FUNCTION public.workspace_has_feature(p_ws uuid,p_feature text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.workspace_limits(p_ws)->'features' ? p_feature
$$;
CREATE FUNCTION public.refresh_rank(p_frequency text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_frequency WHEN 'daily' THEN 3 WHEN 'weekly' THEN 2 WHEN 'monthly' THEN 1 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.workspace_has_feature(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_has_feature(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_rank(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_readonly_token(p_label text, p_hash text, p_scope text, p_hours integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 IF NOT public.workspace_has_feature(public.acting_workspace(),CASE WHEN p_scope IN('support:read','analytics:read','health:read') THEN 'api' ELSE 'mcp' END) THEN RAISE EXCEPTION 'Upgrade required: % is not included in your plan',CASE WHEN p_scope IN('support:read','analytics:read','health:read') THEN 'API access' ELSE 'the MCP server' END;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=public.acting_workspace() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(public.acting_workspace(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.configure_demo_webhook(p_url text, p_enabled boolean, p_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r demo_webhooks;k text;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_enabled IS NULL OR p_enabled AND p_consent IS DISTINCT FROM true OR p_url IS NULL OR length(p_url)>500 OR p_url!~'^https://[A-Za-z0-9.-]+(/[^?#]*)?$' THEN RAISE EXCEPTION 'Invalid URL or consent';END IF;
 IF p_enabled AND NOT public.workspace_has_feature(public.acting_workspace(),'webhooks') THEN RAISE EXCEPTION 'Upgrade required: webhooks are not included in your plan';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 SELECT * INTO r FROM demo_webhooks WHERE user_id=public.acting_workspace() FOR UPDATE;
 IF FOUND THEN
  IF r.url<>p_url THEN DELETE FROM demo_webhook_events WHERE webhook_id=r.id; k:=encode(gen_random_bytes(32),'hex');END IF;
  UPDATE demo_webhooks SET url=p_url,enabled=p_enabled,secret=coalesce(k,secret) WHERE id=r.id;
 ELSE k:=encode(gen_random_bytes(32),'hex');INSERT INTO demo_webhooks(user_id,url,enabled,secret) VALUES(public.acting_workspace(),p_url,p_enabled,k) RETURNING * INTO r;END IF;
 IF NOT p_enabled THEN UPDATE demo_webhook_events SET status='failed' WHERE webhook_id=r.id AND status IN('pending','sending');END IF;
 RETURN jsonb_build_object('id',r.id,'signingKey',k);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_refresh_settings(p_frequency text, p_sitemap_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();u text:=nullif(btrim(coalesce(p_sitemap_url,'')),'');old text;had boolean:=false;
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_frequency IS NULL OR p_frequency NOT IN('off','monthly','weekly','daily') THEN RAISE EXCEPTION 'Invalid frequency';END IF;
 IF public.refresh_rank(p_frequency)>public.refresh_rank(public.workspace_limits(uid)->>'refresh') THEN RAISE EXCEPTION 'Upgrade required: % refresh is not included in your plan',p_frequency;END IF;
 SELECT sitemap_url,true INTO old,had FROM refresh_settings WHERE user_id=uid;
 INSERT INTO refresh_settings(user_id,frequency,sitemap_url,next_due_at) VALUES(uid,p_frequency,u,CASE WHEN p_frequency='off' THEN NULL ELSE clock_timestamp() END)
  ON CONFLICT(user_id) DO UPDATE SET frequency=EXCLUDED.frequency,sitemap_url=EXCLUDED.sitemap_url,updated_at=clock_timestamp(),
   next_due_at=CASE WHEN EXCLUDED.frequency='off' THEN NULL
    WHEN refresh_settings.last_run_at IS NULL THEN clock_timestamp()
    ELSE refresh_settings.last_run_at+public.refresh_interval(EXCLUDED.frequency) END;
 IF coalesce(had,false) AND old IS DISTINCT FROM u THEN DELETE FROM refresh_seen_urls WHERE user_id=uid;END IF;
 RETURN true;
END$function$;

CREATE OR REPLACE FUNCTION public.service_refresh_claim(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb;
BEGIN
 WITH due AS (SELECT user_id FROM refresh_settings WHERE frequency<>'off' AND next_due_at<=clock_timestamp()
   AND public.refresh_rank(frequency)<=public.refresh_rank(public.workspace_limits(user_id)->>'refresh')
   ORDER BY next_due_at LIMIT least(greatest(coalesce(p_limit,3),1),10) FOR UPDATE SKIP LOCKED),
  claimed AS (UPDATE refresh_settings s SET next_due_at=clock_timestamp()+interval '1 hour' FROM due WHERE s.user_id=due.user_id RETURNING s.user_id,s.frequency,s.sitemap_url)
 SELECT coalesce(jsonb_agg(jsonb_build_object('workspace',user_id,'frequency',frequency,'sitemapUrl',sitemap_url)),'[]'::jsonb) INTO r FROM claimed;
 RETURN r;
END$function$;

CREATE OR REPLACE FUNCTION public.service_insights_pending(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  WHERE coalesce(s.enabled,true) AND public.workspace_has_feature(c.user_id,'insights')
   AND EXISTS(SELECT 1 FROM knowledge_interactions k WHERE k.case_id=c.id)
   AND a.at<now()-interval '30 minutes' AND a.at>now()-interval '30 days'
   AND (ci.case_id IS NULL OR ci.activity_at<a.at)
  ORDER BY a.at LIMIT least(greatest(coalesce(p_limit,10),1),25)) q
$function$;

-- Billing notices to the workspace owner (payment failed, subscription cancelled or expired). Account emails:
-- not switchable off, same per-type daily cap as other types.
ALTER TABLE public.email_log DROP CONSTRAINT email_log_email_type_check;
ALTER TABLE public.email_log ADD CONSTRAINT email_log_email_type_check CHECK(email_type IN('owner_alert','weekly_digest','new_lead','team_invite','visitor_reply','billing_notice'));
CREATE OR REPLACE FUNCTION public.email_reserve_internal(p_ws uuid, p_type text, p_recipient_hash text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s email_settings;st text:='reserved';rid uuid;day0 timestamptz:=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 counted text[]:=ARRAY['reserved','sent','dry_run','failed'];cap integer;
BEGIN
 IF p_ws IS NULL OR p_type NOT IN('owner_alert','weekly_digest','new_lead','team_invite','visitor_reply','billing_notice') OR p_recipient_hash IS NULL OR p_recipient_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid email reservation';END IF;
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
END$function$;
