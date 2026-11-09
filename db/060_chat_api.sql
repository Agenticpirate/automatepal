-- Public chat API (Phase 3): POST /api/v1/chat with a 'chat:write' token (API access, Growth and up). Each API
-- conversation is an ordinary support_cases row with source 'api' (no fixture order, 24-hour token), so the
-- answer path, quotas, handoff and transcripts are the widget's. The token is checked here on every call.
ALTER TABLE public.readonly_tokens DROP CONSTRAINT readonly_tokens_scope_check;
ALTER TABLE public.readonly_tokens ADD CONSTRAINT readonly_tokens_scope_check CHECK(scope IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write','chat:write'));
ALTER TABLE public.support_cases DROP CONSTRAINT support_cases_source_check;
ALTER TABLE public.support_cases ADD CONSTRAINT support_cases_source_check CHECK(source IN('demo','widget','api'));
ALTER TABLE public.support_cases DROP CONSTRAINT support_cases_source_shape;
ALTER TABLE public.support_cases ADD CONSTRAINT support_cases_source_shape CHECK(
 (source='demo' AND fictional AND order_label IS NOT NULL AND amount>0 AND amount<=1000)
 OR (source IN('widget','api') AND NOT fictional AND order_label IS NULL AND amount IS NULL));

-- Service role: open an API conversation for a valid chat:write token whose workspace plan has API access.
-- Returns {id, expiresAt} or NULL (invalid, revoked, expired or wrong scope; same answer for all).
CREATE FUNCTION public.api_open_conversation(p_token_hash text,p_case_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t readonly_tokens;cid uuid:=gen_random_uuid();exp timestamptz:=now()+interval '24 hours';
BEGIN
 IF p_case_hash IS NULL OR p_case_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid conversation';END IF;
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_token_hash AND scope='chat:write' AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND OR NOT public.workspace_has_feature(t.user_id,'api') THEN RETURN NULL;END IF;
 IF(SELECT count(*) FROM support_cases WHERE user_id=t.user_id AND source='api' AND created_at>=date_trunc('day',now()))>=5000 THEN RAISE EXCEPTION 'Daily conversation limit reached';END IF;
 INSERT INTO support_cases(id,user_id,token_hash,expires_at,order_label,amount,fictional,source) VALUES(cid,t.user_id,p_case_hash,exp,NULL,NULL,false,'api');
 RETURN jsonb_build_object('id',cid,'expiresAt',exp);
END$$;
-- Service role: an existing API conversation belongs to this token's workspace (and is still open).
CREATE FUNCTION public.api_conversation_ok(p_token_hash text,p_case_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM readonly_tokens t JOIN support_cases c ON c.user_id=t.user_id
  WHERE t.token_hash=p_token_hash AND t.scope='chat:write' AND t.revoked_at IS NULL AND t.expires_at>now()
   AND c.token_hash=p_case_hash AND c.source='api' AND c.expires_at>now() AND public.workspace_has_feature(t.user_id,'api'))
$$;
REVOKE ALL ON FUNCTION public.api_open_conversation(text,text),public.api_conversation_ok(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.api_open_conversation(text,text),public.api_conversation_ok(text,text) TO service_role;

-- Token creation accepts chat:write (as 057, plus the scope).
CREATE OR REPLACE FUNCTION public.create_readonly_token(p_label text, p_hash text, p_scope text, p_hours integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write','chat:write') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 IF NOT public.workspace_has_feature(public.acting_workspace(),CASE WHEN p_scope IN('support:read','analytics:read','health:read','chat:write') THEN 'api' ELSE 'mcp' END) THEN RAISE EXCEPTION 'Upgrade required: % is not included in your plan',CASE WHEN p_scope IN('support:read','analytics:read','health:read','chat:write') THEN 'API access' ELSE 'the MCP server' END;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=public.acting_workspace() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(public.acting_workspace(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$function$;
