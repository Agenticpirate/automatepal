-- 047: MCP reply and settings tools, and owner lead deletion. Apply ONCE, after 046. Not idempotent.
--
-- Model: three new token scopes, each with its own tool, so tokens created before this migration (and the
-- six existing scopes) gain nothing:
--   conversations:reply  reply_to_conversation (plus list_tickets, to find the conversation)
--   settings:read        read_settings
--   settings:write       update_settings (plus read_settings)
-- Every token RPC re-checks the token (not revoked, not expired) and the scope-to-tool map, and logs one
-- metadata row to mcp_calls (tool and outcome, never arguments).
-- Replies follow the 045 post_case_reply rules: the case must already be taken over (MCP never takes over)
-- and its link unexpired, at most 100 messages per case, and the ticket history records that a reply was
-- sent, never the text. The message row records the token and, as actor, the token's owner (the workspace
-- owner account). Settings writes are limited to visitorChoice, hideContact and workingHours in the widget
-- controls, validated here as well as by the server's zod schema, 20 per workspace per UTC day, audited.

-- 1. Scopes.
ALTER TABLE public.readonly_tokens DROP CONSTRAINT readonly_tokens_scope_check;
ALTER TABLE public.readonly_tokens ADD CONSTRAINT readonly_tokens_scope_check CHECK(scope IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write'));
-- create_readonly_token: the 046 body with the scope list extended (minimum role admin).
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
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=public.acting_workspace() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(public.acting_workspace(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$function$;

-- 2. Which token posted a team reply (NULL for replies from a signed-in person).
ALTER TABLE public.support_messages ADD COLUMN token_id uuid REFERENCES public.readonly_tokens(id) ON DELETE SET NULL;

-- 3. Scope-to-tool map: the 046 map plus the three new tools. Existing scopes are unchanged.
CREATE OR REPLACE FUNCTION public.mcp_tool_allowed(p_scope text,p_tool text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(CASE p_tool
  WHEN 'knowledge_sources' THEN p_scope IN('mcp:read','knowledge:write')
  WHEN 'tickets' THEN p_scope IN('mcp:read','support:read','conversations:reply')
  WHEN 'unanswered' THEN p_scope='mcp:read'
  WHEN 'overview' THEN p_scope IN('mcp:read','analytics:read')
  WHEN 'billing_status' THEN p_scope IN('mcp:read','support:read')
  WHEN 'add_text_knowledge_source' THEN p_scope='knowledge:write'
  WHEN 'ask_test_question' THEN p_scope='bot:test'
  WHEN 'reply_to_conversation' THEN p_scope='conversations:reply'
  WHEN 'read_settings' THEN p_scope IN('settings:read','settings:write')
  WHEN 'update_settings' THEN p_scope='settings:write'
  ELSE false END,false)
$$;
-- mcp_log: the 046 body; today's successful update_settings rows are also kept, because its daily cap counts them.
CREATE OR REPLACE FUNCTION public.mcp_log(p_ws uuid,p_token uuid,p_tool text,p_outcome text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE day0 timestamptz:=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,46));
 DELETE FROM mcp_calls WHERE id IN(SELECT id FROM mcp_calls WHERE user_id=p_ws
  AND NOT(outcome='ok' AND tool IN('add_text_knowledge_source','ask_test_question','update_settings') AND created_at>=day0)
  ORDER BY created_at DESC,id DESC OFFSET 499);
 INSERT INTO mcp_calls(user_id,token_id,tool,outcome) VALUES(p_ws,p_token,coalesce(nullif(left(p_tool,60),''),'unknown'),p_outcome);
END$$;
CREATE OR REPLACE FUNCTION public.mcp_token_scope(p_hash text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT scope FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now()
  AND scope IN('mcp:read','support:read','analytics:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write')
$$;
-- Owner audit row for a token write (metadata only). The table triggers only log signed-in workspace writes.
CREATE FUNCTION public.mcp_audit(p_ws uuid,p_resource text,p_op text,p_rid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.acting_workspace() IS NOT DISTINCT FROM p_ws THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,42));
 DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=p_ws ORDER BY created_at DESC,id DESC OFFSET 999);
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(p_ws,p_resource,p_op,p_rid,p_ws);
END$$;
REVOKE ALL ON FUNCTION public.mcp_audit(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

-- 4. reply_to_conversation.
CREATE FUNCTION public.mcp_reply_to_conversation(p_hash text,p_case uuid,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t readonly_tokens;uid uuid;r support_cases;rid uuid;b text:=btrim(p_body);
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF NOT public.mcp_tool_allowed(t.scope,'reply_to_conversation') THEN PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','refused');RETURN jsonb_build_object('refused',true);END IF;
 IF b IS NULL OR length(b) NOT BETWEEN 1 AND 1000 THEN
  PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','error');RETURN jsonb_build_object('invalid','Write a reply of 1 to 1000 characters.');
 END IF;
 SELECT * INTO r FROM support_cases WHERE id=p_case AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','error');RETURN jsonb_build_object('invalid','Conversation not found in this workspace.');END IF;
 IF r.inbox_state IS DISTINCT FROM 'taken_over' THEN
  PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','error');RETURN jsonb_build_object('invalid','Take over this conversation in Tickets first. MCP cannot take over a conversation.');
 END IF;
 IF r.expires_at<=now() THEN PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','error');RETURN jsonb_build_object('invalid','This conversation link has expired.');END IF;
 IF(SELECT count(*) FROM support_messages WHERE case_id=p_case)>=100 THEN
  PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','budget');RETURN jsonb_build_object('budget',true,'quota','Message limit reached: 100 messages per conversation.');
 END IF;
 INSERT INTO support_messages(user_id,case_id,author,body,actor_id,token_id) VALUES(uid,p_case,'owner',b,uid,t.id) RETURNING id INTO rid;
 UPDATE support_cases SET ticket_updated_at=clock_timestamp(),first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()) WHERE id=p_case;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=p_case)<200 THEN
  INSERT INTO ticket_events(user_id,case_id,kind,body,actor_id) VALUES(uid,p_case,'owner_update','Owner replied in the widget via an MCP token',uid);
 END IF;
 PERFORM public.mcp_audit(uid,'support_messages','INSERT',rid);
 PERFORM public.mcp_log(uid,t.id,'reply_to_conversation','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('id',rid,'shownInWidget',true,'emailed',false));
END$$;

-- 5. Settings. Validation of the allowed keys (internal): NULL when valid, else a client-safe message.
CREATE FUNCTION public.mcp_settings_problem(p jsonb) RETURNS text LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE wh jsonb;d jsonb;k text;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR p='{}'::jsonb THEN RETURN 'Send at least one of visitorChoice, hideContact or workingHours.';END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP
  IF k NOT IN('visitorChoice','hideContact','workingHours') THEN RETURN 'Only visitorChoice, hideContact and workingHours can be changed over MCP.';END IF;
 END LOOP;
 IF p ? 'visitorChoice' AND jsonb_typeof(p->'visitorChoice')<>'boolean' THEN RETURN 'visitorChoice must be true or false.';END IF;
 IF p ? 'hideContact' AND jsonb_typeof(p->'hideContact')<>'boolean' THEN RETURN 'hideContact must be true or false.';END IF;
 IF p ? 'workingHours' THEN
  wh:=p->'workingHours';
  IF jsonb_typeof(wh)<>'object' THEN RETURN 'workingHours must be an object.';END IF;
  FOR k IN SELECT jsonb_object_keys(wh) LOOP
   IF k NOT IN('enabled','timezone','days','awayMessage') THEN RETURN 'Unknown working hours field.';END IF;
  END LOOP;
  IF jsonb_typeof(wh->'enabled') IS DISTINCT FROM 'boolean' THEN RETURN 'workingHours.enabled must be true or false.';END IF;
  IF jsonb_typeof(wh->'timezone') IS DISTINCT FROM 'string' OR length(wh->>'timezone') NOT BETWEEN 1 AND 64
   OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=wh->>'timezone') THEN RETURN 'Unknown time zone.';END IF;
  IF jsonb_typeof(wh->'days') IS DISTINCT FROM 'array' OR jsonb_array_length(wh->'days')>14 THEN RETURN 'workingHours.days must be a list of up to 14 ranges.';END IF;
  FOR d IN SELECT jsonb_array_elements(wh->'days') LOOP
   IF jsonb_typeof(d)<>'object' THEN RETURN 'Each range needs day 0-6 and 24-hour HH:MM start and end.';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(d) x(key) WHERE x.key NOT IN('day','start','end'))
    OR jsonb_typeof(d->'day') IS DISTINCT FROM 'number' OR (d->>'day')!~'^[0-6]$'
    OR jsonb_typeof(d->'start') IS DISTINCT FROM 'string' OR (d->>'start')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR jsonb_typeof(d->'end') IS DISTINCT FROM 'string' OR (d->>'end')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN 'Each range needs day 0-6 and 24-hour HH:MM start and end.';
   END IF;
  END LOOP;
  IF jsonb_typeof(wh->'awayMessage') IS DISTINCT FROM 'string' OR char_length(wh->>'awayMessage')>300 THEN RETURN 'awayMessage must be text of up to 300 characters.';END IF;
 END IF;
 RETURN NULL;
END$$;
REVOKE ALL ON FUNCTION public.mcp_settings_problem(jsonb) FROM PUBLIC,anon,authenticated;

-- read_settings: only the MCP-editable keys of the widget controls (no branding, origins or paths).
CREATE FUNCTION public.mcp_read_settings(p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t readonly_tokens;uid uuid;c jsonb;
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 uid:=t.user_id;
 IF NOT public.mcp_tool_allowed(t.scope,'read_settings') THEN PERFORM public.mcp_log(uid,t.id,'read_settings','refused');RETURN jsonb_build_object('refused',true);END IF;
 SELECT controls INTO c FROM widget_settings WHERE user_id=uid;
 PERFORM public.mcp_log(uid,t.id,'read_settings','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('configured',c IS NOT NULL,
  'visitorChoice',coalesce(c->'visitorChoice','true'::jsonb),'hideContact',coalesce(c->'hideContact','false'::jsonb),'workingHours',coalesce(c->'workingHours','null'::jsonb)));
END$$;

-- update_settings: replaces the given keys only. 20 per workspace per UTC day.
CREATE FUNCTION public.mcp_update_settings(p_hash text,p_settings jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 existed:=EXISTS(SELECT 1 FROM widget_settings WHERE user_id=uid);
 BEGIN
  INSERT INTO widget_settings(user_id,controls) VALUES(uid,p_settings)
   ON CONFLICT(user_id) DO UPDATE SET controls=widget_settings.controls||EXCLUDED.controls
   RETURNING controls INTO c;
 EXCEPTION WHEN check_violation THEN
  PERFORM public.mcp_log(uid,t.id,'update_settings','error');RETURN jsonb_build_object('invalid','Widget settings are too large to save.');
 END;
 PERFORM public.mcp_audit(uid,'widget_settings',CASE WHEN existed THEN 'UPDATE' ELSE 'INSERT' END,uid);
 PERFORM public.mcp_log(uid,t.id,'update_settings','ok');
 RETURN jsonb_build_object('ok',true,'data',jsonb_build_object('configured',true,
  'visitorChoice',coalesce(c->'visitorChoice','true'::jsonb),'hideContact',coalesce(c->'hideContact','false'::jsonb),'workingHours',coalesce(c->'workingHours','null'::jsonb)));
END$$;

REVOKE ALL ON FUNCTION public.mcp_reply_to_conversation(text,uuid,text),public.mcp_read_settings(text),public.mcp_update_settings(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_reply_to_conversation(text,uuid,text),public.mcp_read_settings(text),public.mcp_update_settings(text,jsonb) TO anon,authenticated;

-- 6. Leads: a lead is a consented contact email on a support request. Deleting a lead removes the address
-- and the consent flag; the request itself stays. Minimum role manager, acting workspace only. Audited by
-- the existing owner_audit trigger on support_requests.
CREATE FUNCTION public.delete_lead(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 UPDATE support_requests SET contact_email=NULL,contact_consent=false WHERE id=p_id AND user_id=uid AND contact_email IS NOT NULL;
 RETURN FOUND;
END$$;
REVOKE ALL ON FUNCTION public.delete_lead(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_lead(uuid) TO authenticated;
