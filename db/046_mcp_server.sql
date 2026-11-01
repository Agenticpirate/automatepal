-- 046: MCP server at /mcp. Apply ONCE, after 045. Not idempotent.
--
-- Model: the existing hashed, scoped, expiring tokens (readonly_tokens, prefix ap_ro_) authenticate MCP
-- clients. Three new scopes: mcp:read (all read tools), knowledge:write (propose a text source that stays
-- UNPUBLISHED and pending until a manager approves it) and bot:test (ask the bot a test question). Every
-- token RPC validates the token (not revoked, not expired) and the scope-to-tool map, and logs one
-- metadata row to mcp_calls. Read results are metadata or SQL counts only: no message bodies, contact
-- addresses, ciphertext or key hints. Nothing here sends anything to a visitor or runs code.

-- 1. Scopes.
ALTER TABLE public.readonly_tokens DROP CONSTRAINT readonly_tokens_scope_check;
ALTER TABLE public.readonly_tokens ADD CONSTRAINT readonly_tokens_scope_check CHECK(scope IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test'));
-- create_readonly_token: the 043 body with the scope list extended (minimum role admin).
CREATE OR REPLACE FUNCTION public.create_readonly_token(p_label text, p_hash text, p_scope text, p_hours integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=public.acting_workspace() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(public.acting_workspace(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$function$;

-- 2. Knowledge proposals. A proposal is never published and has no chunks until the owner approves it and
-- then saves it with consent and publication through the normal Knowledge flow (which embeds it).
ALTER TABLE public.knowledge_documents
 ADD COLUMN pending_approval boolean NOT NULL DEFAULT false,
 ADD COLUMN proposed_by_token uuid REFERENCES public.readonly_tokens(id) ON DELETE SET NULL;
CREATE FUNCTION public.knowledge_pending_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.pending_approval AND NEW.published THEN RAISE EXCEPTION 'Approve the proposed source before publishing';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.knowledge_pending_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER knowledge_pending_guard BEFORE INSERT OR UPDATE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION public.knowledge_pending_guard();
-- approve_knowledge_proposal: minimum role manager. Clears the pending flag only; the source stays unpublished.
CREATE FUNCTION public.approve_knowledge_proposal(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 UPDATE knowledge_documents SET pending_approval=false,updated_at=clock_timestamp() WHERE id=p_id AND user_id=uid AND pending_approval;
 RETURN FOUND;
END$$;

-- 3. Call log: one metadata row per MCP tool call (tool name and outcome only, never arguments).
CREATE TABLE public.mcp_calls(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 token_id uuid NOT NULL REFERENCES public.readonly_tokens(id) ON DELETE CASCADE,
 tool text NOT NULL CHECK(length(tool) BETWEEN 1 AND 60),
 outcome text NOT NULL CHECK(outcome IN('ok','refused','error','budget')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mcp_calls_ws_time ON public.mcp_calls(user_id,created_at DESC);
CREATE INDEX mcp_calls_ws_tool_time ON public.mcp_calls(user_id,tool,created_at DESC);
ALTER TABLE public.mcp_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_calls FROM PUBLIC,anon,authenticated;
CREATE POLICY ws_mcp_calls ON public.mcp_calls FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));
GRANT SELECT ON public.mcp_calls TO authenticated;

-- Scope-to-tool map (internal). Read tools use the p_tool names of mcp_read_data.
CREATE FUNCTION public.mcp_tool_allowed(p_scope text,p_tool text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(CASE p_tool
  WHEN 'knowledge_sources' THEN p_scope IN('mcp:read','knowledge:write')
  WHEN 'tickets' THEN p_scope IN('mcp:read','support:read')
  WHEN 'unanswered' THEN p_scope='mcp:read'
  WHEN 'overview' THEN p_scope IN('mcp:read','analytics:read')
  WHEN 'billing_status' THEN p_scope IN('mcp:read','support:read')
  WHEN 'add_text_knowledge_source' THEN p_scope='knowledge:write'
  WHEN 'ask_test_question' THEN p_scope='bot:test'
  ELSE false END,false)
$$;
-- Log a call (internal). Keeps 500 rows per workspace, except today's successful write-tool rows, which the
-- daily caps count; those are bounded by the caps (10 + 20 per UTC day), so pruning cannot reset a cap.
CREATE FUNCTION public.mcp_log(p_ws uuid,p_token uuid,p_tool text,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE day0 timestamptz:=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,46));
 DELETE FROM mcp_calls WHERE id IN(SELECT id FROM mcp_calls WHERE user_id=p_ws
  AND NOT(outcome='ok' AND tool IN('add_text_knowledge_source','ask_test_question') AND created_at>=day0)
  ORDER BY created_at DESC,id DESC OFFSET 499);
 INSERT INTO mcp_calls(user_id,token_id,tool,outcome) VALUES(p_ws,p_token,coalesce(nullif(left(p_tool,60),''),'unknown'),p_outcome);
END$$;
-- Successful calls of a write tool today (internal; caller holds the workspace lock 46).
CREATE FUNCTION public.mcp_used_today(p_ws uuid,p_tool text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT count(*)::int FROM mcp_calls WHERE user_id=p_ws AND tool=p_tool AND outcome='ok' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
$$;
REVOKE ALL ON FUNCTION public.mcp_tool_allowed(text,text),public.mcp_log(uuid,uuid,text,text),public.mcp_used_today(uuid,text) FROM PUBLIC,anon,authenticated;

-- 4. Token RPCs. NULL means an unknown, revoked or expired token (or a scope with no MCP tools).
-- Other results: {ok:true,data}, {refused:true} (scope does not allow the tool), {budget:true,limit} (daily cap
-- or source quota), {invalid:message}.
CREATE FUNCTION public.mcp_token_scope(p_hash text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT scope FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now()
  AND scope IN('mcp:read','support:read','analytics:read','knowledge:write','bot:test')
$$;

CREATE FUNCTION public.mcp_read_data(p_hash text,p_tool text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  r:=jsonb_build_object('sources',r,'sourceLimit',30,'pageLimit',360);
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
     'pageUnits',coalesce(sum(ceil(length(content)::numeric/2500)),0)::int,'sourceLimit',30,'pageLimit',360) FROM knowledge_documents WHERE user_id=uid),
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
END$$;

CREATE FUNCTION public.mcp_add_knowledge_source(p_hash text,p_title text,p_content text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t readonly_tokens;uid uuid;rid uuid:=gen_random_uuid();cnt integer;pages numeric;ti text:=btrim(p_title);co text:=btrim(p_content);
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
 IF cnt>=30 OR pages+ceil(length(co)::numeric/2500)>360 THEN
  PERFORM public.mcp_log(uid,t.id,'add_text_knowledge_source','budget');RETURN jsonb_build_object('budget',true,'quota','Preview quota reached: 30 sources or 360 page units.');
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
END$$;

-- Test-question context: an exact published custom answer, else the workspace's published chunks (<=900).
-- Records no knowledge_interactions. 20 per workspace per UTC day.
CREATE FUNCTION public.mcp_test_context(p_hash text,p_question text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE t readonly_tokens;uid uuid;cu jsonb;ch jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF NOT public.mcp_tool_allowed(t.scope,'ask_test_question') THEN PERFORM public.mcp_log(uid,t.id,'ask_test_question','refused');RETURN jsonb_build_object('refused',true);END IF;
 IF p_question IS NULL OR length(btrim(p_question)) NOT BETWEEN 3 AND 300 THEN
  PERFORM public.mcp_log(uid,t.id,'ask_test_question','error');RETURN jsonb_build_object('invalid','Ask a question of 3 to 300 characters.');
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,46));
 IF public.mcp_used_today(uid,'ask_test_question')>=20 THEN PERFORM public.mcp_log(uid,t.id,'ask_test_question','budget');RETURN jsonb_build_object('budget',true,'limit',20);END IF;
 SELECT jsonb_build_object('id',r.id,'title',r.question,'answer',r.answer) INTO cu FROM custom_responses r
  WHERE r.user_id=uid AND r.published AND r.normalized_question=public.normalize_support_question(p_question) LIMIT 1;
 IF cu IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'documentId',x.document_id,'title',x.title,'excerpt',x.content,'embedding',x.embedding::text,
    'sourceKind',x.source_kind,'applicability',x.applicability,'effectiveFrom',x.effective_from,'effectiveUntil',x.effective_until)),'[]'::jsonb) INTO ch
  FROM(SELECT k.id,k.document_id,d.title,k.content,k.embedding,d.source_kind,d.applicability,d.effective_from,d.effective_until
   FROM knowledge_chunks k JOIN knowledge_documents d ON d.id=k.document_id
   WHERE k.user_id=uid AND d.user_id=uid AND d.published ORDER BY d.created_at,k.position LIMIT 900)x;
 END IF;
 PERFORM public.mcp_log(uid,t.id,'ask_test_question','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('custom',cu,'chunks',ch));
END$$;

REVOKE ALL ON FUNCTION public.mcp_token_scope(text),public.mcp_read_data(text,text),public.mcp_add_knowledge_source(text,text,text),public.mcp_test_context(text,text),public.approve_knowledge_proposal(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_token_scope(text),public.mcp_read_data(text,text),public.mcp_add_knowledge_source(text,text,text),public.mcp_test_context(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_knowledge_proposal(uuid) TO authenticated;

-- 5. delete_preview_data: the 045 body plus mcp_calls (before readonly_tokens).
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
