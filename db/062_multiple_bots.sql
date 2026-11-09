-- Multiple chatbots per workspace (Phase 3). A bot is its own widget configuration: look, controls, install
-- key, logo, language, starters and answer model (widget_settings is now one row per bot). The workspace's
-- existing configuration becomes its "Main bot", whose id is the workspace id, so every existing row, key and
-- conversation keeps working unchanged (a conversation without bot_id belongs to the Main bot).
-- Knowledge stays one library per workspace; a source or exact answer can be limited to some bots
-- (bot_ids, NULL = every bot), and the visitor-facing lookups only see what the conversation's bot may use.
-- How many bots a workspace may have comes from its plan (db/057 plan_limits 'bots').

CREATE TABLE public.bots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 60),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,name)
);
CREATE INDEX bots_workspace ON public.bots(workspace_id,created_at);
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bots TO authenticated;
CREATE POLICY ws_bots_read ON public.bots FOR SELECT TO authenticated
 USING(workspace_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
INSERT INTO public.bots(id,workspace_id,name) SELECT user_id,user_id,'Main bot' FROM public.widget_settings ON CONFLICT DO NOTHING;

-- widget_settings: one row per bot.
ALTER TABLE public.widget_settings ADD COLUMN bot_id uuid;
UPDATE public.widget_settings SET bot_id=user_id;
ALTER TABLE public.widget_settings ALTER COLUMN bot_id SET NOT NULL;
ALTER TABLE public.widget_settings DROP CONSTRAINT widget_settings_pkey;
ALTER TABLE public.widget_settings ADD PRIMARY KEY(bot_id);
ALTER TABLE public.widget_settings ADD CONSTRAINT widget_settings_bot_fk FOREIGN KEY(bot_id) REFERENCES public.bots(id) ON DELETE CASCADE;
CREATE INDEX widget_settings_workspace ON public.widget_settings(user_id);
-- A row without a bot is the Main bot (created on first use); a named bot must belong to the same workspace;
-- the bot and workspace of a row never change.
CREATE FUNCTION public.widget_settings_bot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.bot_id IS DISTINCT FROM OLD.bot_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'A bot''s settings cannot move';END IF;
  RETURN NEW;
 END IF;
 NEW.bot_id:=coalesce(NEW.bot_id,NEW.user_id);
 IF NEW.bot_id=NEW.user_id THEN INSERT INTO bots(id,workspace_id,name) VALUES(NEW.user_id,NEW.user_id,'Main bot') ON CONFLICT DO NOTHING;
 ELSIF NOT EXISTS(SELECT 1 FROM bots WHERE id=NEW.bot_id AND workspace_id=NEW.user_id) THEN RAISE EXCEPTION 'Unknown bot';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER widget_settings_bot BEFORE INSERT OR UPDATE ON public.widget_settings FOR EACH ROW EXECUTE FUNCTION public.widget_settings_bot();

-- Conversations remember their bot; knowledge can be limited to bots.
ALTER TABLE public.support_cases ADD COLUMN bot_id uuid REFERENCES public.bots(id) ON DELETE SET NULL;
ALTER TABLE public.knowledge_documents ADD COLUMN bot_ids uuid[] CHECK(bot_ids IS NULL OR cardinality(bot_ids) BETWEEN 1 AND 100);
ALTER TABLE public.custom_responses ADD COLUMN bot_ids uuid[] CHECK(bot_ids IS NULL OR cardinality(bot_ids) BETWEEN 1 AND 100);

-- The acting workspace's bot, or its Main bot when p_bot is NULL; NULL when the bot is not in the workspace.
CREATE FUNCTION public.acting_bot(p_bot uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN p_bot IS NULL OR p_bot=public.acting_workspace() THEN public.acting_workspace()
  WHEN EXISTS(SELECT 1 FROM bots WHERE id=p_bot AND workspace_id=public.acting_workspace()) THEN p_bot END
$$;
REVOKE ALL ON FUNCTION public.acting_bot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.acting_bot(uuid) TO authenticated;

-- Bots: managers and up create, rename and delete. The Main bot cannot be deleted. The plan sets how many.
CREATE FUNCTION public.create_bot(p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();rid uuid;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Invalid name';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws::text,62));
 INSERT INTO bots(id,workspace_id,name) VALUES(ws,ws,'Main bot') ON CONFLICT DO NOTHING;
 IF(SELECT count(*) FROM bots WHERE workspace_id=ws)>=(public.workspace_limits(ws)->>'bots')::int THEN RAISE EXCEPTION 'Upgrade required: your plan includes % bot(s)',public.workspace_limits(ws)->>'bots';END IF;
 INSERT INTO bots(workspace_id,name) VALUES(ws,btrim(p_name)) RETURNING id INTO rid;
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(ws,'bots','INSERT',rid,auth.uid());
 RETURN rid;
END$$;
CREATE FUNCTION public.rename_bot(p_id uuid,p_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Invalid name';END IF;
 IF p_id=ws THEN INSERT INTO bots(id,workspace_id,name) VALUES(ws,ws,'Main bot') ON CONFLICT DO NOTHING;END IF;
 UPDATE bots SET name=btrim(p_name) WHERE id=p_id AND workspace_id=ws;
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(ws,'bots','UPDATE',p_id,auth.uid());
 RETURN true;
END$$;
CREATE FUNCTION public.delete_bot(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF p_id=ws THEN RAISE EXCEPTION 'The Main bot cannot be deleted';END IF;
 -- Its settings and key go with it (cascade); its conversations move to the Main bot; knowledge limited to it
 -- forgets it (a source limited only to it becomes available to every bot).
 UPDATE knowledge_documents SET bot_ids=nullif(array_remove(bot_ids,p_id),'{}') WHERE user_id=ws AND p_id=ANY(bot_ids);
 UPDATE custom_responses SET bot_ids=nullif(array_remove(bot_ids,p_id),'{}') WHERE user_id=ws AND p_id=ANY(bot_ids);
 DELETE FROM bots WHERE id=p_id AND workspace_id=ws;
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(ws,'bots','DELETE',p_id,auth.uid());
 RETURN true;
END$$;
-- Limit a source ('source') or exact answer ('response') to some bots, or NULL for every bot.
CREATE FUNCTION public.set_knowledge_bots(p_kind text,p_id uuid,p_bots uuid[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();b uuid[];
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF p_kind NOT IN('source','response') THEN RAISE EXCEPTION 'Invalid kind';END IF;
 b:=CASE WHEN p_bots IS NULL OR cardinality(p_bots)=0 THEN NULL ELSE (SELECT array_agg(DISTINCT x) FROM unnest(p_bots) x) END;
 IF b IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(b) x WHERE x<>ws AND NOT EXISTS(SELECT 1 FROM bots WHERE id=x AND workspace_id=ws)) THEN RAISE EXCEPTION 'Unknown bot';END IF;
 IF p_kind='source' THEN UPDATE knowledge_documents SET bot_ids=b WHERE id=p_id AND user_id=ws;
 ELSE UPDATE custom_responses SET bot_ids=b WHERE id=p_id AND user_id=ws;END IF;
 IF NOT FOUND THEN RETURN false;END IF;
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(ws,CASE WHEN p_kind='source' THEN 'knowledge_documents' ELSE 'custom_responses' END,'UPDATE',p_id,auth.uid());
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.create_bot(text),public.rename_bot(uuid,text),public.delete_bot(uuid),public.set_knowledge_bots(text,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_bot(text),public.rename_bot(uuid,text),public.delete_bot(uuid),public.set_knowledge_bots(text,uuid,uuid[]) TO authenticated;

-- Effective answer model for a bot (058 had one per workspace). The 1-argument form is the Main bot.
CREATE FUNCTION public.effective_model_tier(p_ws uuid,p_bot uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN (SELECT controls->>'modelTier' FROM widget_settings WHERE bot_id=coalesce(p_bot,p_ws) AND user_id=p_ws)='deep' AND public.workspace_plan(p_ws)<>'free' THEN 'deep' ELSE 'fast' END
$$;
CREATE OR REPLACE FUNCTION public.effective_model_tier(p_ws uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.effective_model_tier(p_ws,p_ws)
$$;
REVOKE ALL ON FUNCTION public.effective_model_tier(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.effective_model_tier(uuid,uuid) TO service_role;

-- Owner key and logo functions gain a bot argument (NULL = Main bot); the old forms act on the Main bot.
CREATE FUNCTION public.rotate_widget_key(p_key text,p_bot uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();b uuid:=public.acting_bot(p_bot);
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF b IS NULL THEN RAISE EXCEPTION 'Unknown bot';END IF;
 IF p_key IS NULL OR p_key !~ '^pk_(live|test)_[A-Za-z0-9]{24}$' THEN RAISE EXCEPTION 'Invalid key';END IF;
 PERFORM set_config('app.widget_key_rpc','1',true);
 INSERT INTO widget_settings(user_id,bot_id,public_key,key_active,key_rotated_at) VALUES(ws,b,p_key,true,now())
  ON CONFLICT(bot_id) DO UPDATE SET public_key=excluded.public_key,key_active=true,key_rotated_at=now();
 PERFORM set_config('app.widget_key_rpc','',true);
 RETURN true;
END$$;
CREATE OR REPLACE FUNCTION public.rotate_widget_key(p_key text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.rotate_widget_key(p_key,NULL::uuid) $$;
CREATE FUNCTION public.set_widget_key_active(p_active boolean,p_bot uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();b uuid:=public.acting_bot(p_bot);n integer;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF b IS NULL THEN RAISE EXCEPTION 'Unknown bot';END IF;
 IF p_active IS NULL THEN RAISE EXCEPTION 'Invalid value';END IF;
 PERFORM set_config('app.widget_key_rpc','1',true);
 UPDATE widget_settings SET key_active=p_active WHERE bot_id=b AND user_id=ws AND public_key IS NOT NULL;
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('app.widget_key_rpc','',true);
 RETURN n>0;
END$$;
CREATE OR REPLACE FUNCTION public.set_widget_key_active(p_active boolean) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.set_widget_key_active(p_active,NULL::uuid) $$;
CREATE FUNCTION public.set_widget_logo(p_type text,p_data text,p_bot uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();b uuid:=public.acting_bot(p_bot);v integer;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF b IS NULL THEN RAISE EXCEPTION 'Unknown bot';END IF;
 IF (p_type IS NULL)<>(p_data IS NULL) THEN RAISE EXCEPTION 'Invalid logo';END IF;
 INSERT INTO widget_settings(user_id,bot_id,logo_type,logo_data,logo_version) VALUES(ws,b,p_type,p_data,1)
  ON CONFLICT(bot_id) DO UPDATE SET logo_type=excluded.logo_type,logo_data=excluded.logo_data,logo_version=widget_settings.logo_version+1
  RETURNING logo_version INTO v;
 RETURN v;
END$$;
CREATE OR REPLACE FUNCTION public.set_widget_logo(p_type text,p_data text) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.set_widget_logo(p_type,p_data,NULL::uuid) $$;
REVOKE ALL ON FUNCTION public.rotate_widget_key(text,uuid),public.set_widget_key_active(boolean,uuid),public.set_widget_logo(text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rotate_widget_key(text,uuid),public.set_widget_key_active(boolean,uuid),public.set_widget_logo(text,text,uuid) TO authenticated;

-- Existing functions, now per bot (definitions as of 061, bot join added).

CREATE OR REPLACE FUNCTION public.support_case_view_base(p_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT jsonb_build_object('id',c.id,'order',c.order_label,'amount',c.amount,'currency',c.currency,'fictional',c.fictional,'source',c.source,'botId',coalesce(c.bot_id,c.user_id),
  'status',CASE WHEN c.source='demo' THEN 'Sandbox fixture - no real order or payment' ELSE 'Website chat' END,'expiresAt',c.expires_at,
  'branding',jsonb_build_object('label',coalesce(s.label,'Site help'),'color',coalesce(s.color,'#233de8'),'initials',coalesce(s.initials,'AP'),'prompts',coalesce(s.prompts,'["Ask a question","Talk to a person"]'::jsonb),
   'logoVersion',CASE WHEN s.logo_data IS NULL THEN NULL ELSE s.logo_version END))
 FROM public.support_cases c LEFT JOIN public.widget_settings s ON s.bot_id=coalesce(c.bot_id,c.user_id) AND s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$function$;

CREATE OR REPLACE FUNCTION public.support_case_view(p_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT public.support_case_view_base(p_hash)||jsonb_build_object('controls',coalesce(s.controls,'{}'::jsonb),'inboxState',c.inbox_state,'modelTier',public.effective_model_tier(c.user_id,coalesce(c.bot_id,c.user_id)))
 FROM support_cases c LEFT JOIN widget_settings s ON s.bot_id=coalesce(c.bot_id,c.user_id) AND s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$function$;

CREATE OR REPLACE FUNCTION public.support_reserve_knowledge(p_hash text, p_question text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.support_cases;rid uuid;cap integer:=20;ctl jsonb;tier text;w smallint;
BEGIN
 IF p_question IS NULL OR length(trim(p_question)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid question';END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RAISE EXCEPTION 'AI paused: case taken over, closed or expired';END IF;
 SELECT controls INTO ctl FROM widget_settings WHERE bot_id=coalesce(c.bot_id,c.user_id) AND user_id=c.user_id;
 IF jsonb_typeof(ctl->'maxQuestions')='number' THEN cap:=least(greatest(floor((ctl->>'maxQuestions')::numeric)::integer,1),50);END IF;
 tier:=public.effective_model_tier(c.user_id,coalesce(c.bot_id,c.user_id));w:=CASE WHEN tier='deep' THEN 10 ELSE 1 END;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,0));
 IF(SELECT count(*) FROM knowledge_interactions WHERE case_id=c.id)>=cap THEN RAISE EXCEPTION 'Conversation question limit reached';END IF;
 IF(SELECT coalesce(sum(weight),0) FROM knowledge_interactions WHERE user_id=c.user_id AND created_at>=date_trunc('month',now()))+w>(public.workspace_limits(c.user_id)->>'messages')::int THEN RAISE EXCEPTION 'Monthly message limit reached';END IF;
 INSERT INTO knowledge_interactions(user_id,case_id,question,supported,source_count,model_tier,weight) VALUES(c.user_id,c.id,p_question,false,0,tier,w) RETURNING id INTO rid;RETURN rid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.widget_open_session(p_key text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s widget_settings;cid uuid:=gen_random_uuid();exp timestamptz:=now()+interval '24 hours';
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 SELECT * INTO s FROM widget_settings WHERE public_key=p_key AND key_active;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF(SELECT count(*) FROM support_cases WHERE user_id=s.user_id AND source='widget' AND created_at>=date_trunc('day',now()))>=5000 THEN RAISE EXCEPTION 'Daily conversation limit reached';END IF;
 INSERT INTO support_cases(id,user_id,token_hash,expires_at,order_label,amount,fictional,source,bot_id)
  VALUES(cid,s.user_id,p_token_hash,exp,NULL,NULL,false,'widget',s.bot_id);
 RETURN jsonb_build_object('id',cid,'expiresAt',exp);
END$function$;

CREATE OR REPLACE FUNCTION public.widget_logo(p_key text, p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT jsonb_build_object('type',s.logo_type,'data',s.logo_data,'version',s.logo_version)
 FROM widget_settings s
 WHERE s.logo_data IS NOT NULL AND (
  (p_key IS NOT NULL AND s.public_key=p_key AND s.key_active)
  OR (p_token_hash IS NOT NULL AND (s.user_id,s.bot_id)=(SELECT c.user_id,coalesce(c.bot_id,c.user_id) FROM support_cases c WHERE c.token_hash=p_token_hash AND c.expires_at>now())))
 LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_read_settings(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t readonly_tokens;uid uuid;c jsonb;
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF NOT public.mcp_tool_allowed(t.scope,'read_settings') THEN PERFORM public.mcp_log(uid,t.id,'read_settings','refused');RETURN jsonb_build_object('refused',true);END IF;
 SELECT controls INTO c FROM widget_settings WHERE bot_id=uid AND user_id=uid;
 PERFORM public.mcp_log(uid,t.id,'read_settings','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('configured',c IS NOT NULL,
  'visitorChoice',coalesce(c->'visitorChoice','true'::jsonb),'hideContact',coalesce(c->'hideContact','false'::jsonb),'workingHours',coalesce(c->'workingHours','null'::jsonb)));
END$function$;

CREATE OR REPLACE FUNCTION public.mcp_update_settings(p_hash text, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t readonly_tokens;uid uuid;problem text;existed boolean;c jsonb;
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF NOT public.mcp_tool_allowed(t.scope,'update_settings') THEN PERFORM public.mcp_log(uid,t.id,'update_settings','refused');RETURN jsonb_build_object('refused',true);END IF;
 problem:=public.mcp_settings_problem(p_settings);
 IF problem IS NOT NULL THEN PERFORM public.mcp_log(uid,t.id,'update_settings','error');RETURN jsonb_build_object('invalid',problem);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,46));
 IF public.mcp_used_today(uid,'update_settings')>=20 THEN PERFORM public.mcp_log(uid,t.id,'update_settings','budget');RETURN jsonb_build_object('budget',true,'limit',20);END IF;
 existed:=EXISTS(SELECT 1 FROM widget_settings WHERE bot_id=uid AND user_id=uid);
 BEGIN
  INSERT INTO widget_settings(user_id,bot_id,controls) VALUES(uid,uid,p_settings)
   ON CONFLICT(bot_id) DO UPDATE SET controls=widget_settings.controls||EXCLUDED.controls
   RETURNING controls INTO c;
 EXCEPTION WHEN check_violation THEN
  PERFORM public.mcp_log(uid,t.id,'update_settings','error');RETURN jsonb_build_object('invalid','Widget settings are too large to save.');
 END;
 PERFORM public.mcp_audit(uid,'widget_settings',CASE WHEN existed THEN 'UPDATE' ELSE 'INSERT' END,uid);
 PERFORM public.mcp_log(uid,t.id,'update_settings','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('configured',true,
  'visitorChoice',coalesce(c->'visitorChoice','true'::jsonb),'hideContact',coalesce(c->'hideContact','false'::jsonb),'workingHours',coalesce(c->'workingHours','null'::jsonb)));
END$function$;

CREATE OR REPLACE FUNCTION public.support_knowledge_vectors(p_hash text, p_embedding vector)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'documentId',x.document_id,'title',x.title,'excerpt',x.content,'score',x.score,'sourceKind',x.source_kind,'applicability',x.applicability,'effectiveFrom',x.effective_from,'effectiveUntil',x.effective_until) ORDER BY x.source_kind DESC,x.score DESC),'[]'::jsonb)
 FROM (SELECT * FROM (
 SELECT k.id,k.document_id,d.title,k.content,1-(k.embedding<=>p_embedding) score,d.source_kind,d.applicability,d.effective_from,d.effective_until,
 row_number() OVER(PARTITION BY d.source_kind ORDER BY k.embedding<=>p_embedding) rn
 FROM public.knowledge_chunks k JOIN public.knowledge_documents d ON d.id=k.document_id AND d.user_id=k.user_id
 JOIN public.support_cases c ON c.user_id=d.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND (d.bot_ids IS NULL OR coalesce(c.bot_id,c.user_id)=ANY(d.bot_ids)) AND k.model='gemini-embedding-2' AND 1-(k.embedding<=>p_embedding)>=0.72
 ) ranked WHERE rn<=4) x;
$function$;

CREATE OR REPLACE FUNCTION public.support_knowledge_search(p_hash text, p_query text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'excerpt',x.excerpt)),'[]'::jsonb) FROM (
 SELECT d.id,d.title,left(d.content,5000) excerpt
 FROM public.knowledge_documents d JOIN public.support_cases c ON c.user_id=d.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND (d.bot_ids IS NULL OR coalesce(c.bot_id,c.user_id)=ANY(d.bot_ids)) AND length(p_query) BETWEEN 3 AND 500
 AND d.search@@websearch_to_tsquery('english',p_query)
 ORDER BY ts_rank_cd(d.search,websearch_to_tsquery('english',p_query)) DESC LIMIT 3
 )x;
$function$;

CREATE OR REPLACE FUNCTION public.support_custom_response(p_hash text, p_question text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT jsonb_build_object('id',r.id,'title',r.question,'answer',r.answer) FROM public.custom_responses r JOIN public.support_cases c ON c.user_id=r.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND r.published=true AND (r.bot_ids IS NULL OR coalesce(c.bot_id,c.user_id)=ANY(r.bot_ids)) AND length(p_question) BETWEEN 3 AND 500 AND r.normalized_question=public.normalize_support_question(p_question) LIMIT 1
$function$;

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
 DELETE FROM proof_contracts WHERE user_id=uid;
 DELETE FROM action_proposals WHERE user_id=uid;
 DELETE FROM billing_events WHERE user_id=uid;
 DELETE FROM owner_audit_events WHERE user_id=uid;
 DELETE FROM workspace_invites WHERE workspace_id=uid;
 DELETE FROM workspace_members WHERE workspace_id=uid;
 RETURN true;
END;
$function$;
