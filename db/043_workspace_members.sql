-- 043: Team workspaces with roles (owner > admin > manager > agent).
-- Apply ONCE, after 042, to an isolated project first. Not idempotent.
--
-- Model: a workspace is identified by its owner's auth user id, so every existing user_id
-- column keeps meaning "workspace". Members act in a workspace by sending the
-- x-workspace-id request header; public.acting_workspace() validates membership and returns
-- the workspace id, or NULL (fail closed). Without the header a user acts in their own
-- workspace as owner, so single-owner behaviour is unchanged.
--
-- Part 1 (this section, hand-written): tables, resolver, role helpers, team RPCs.
-- Part 2 (generated below the marker): every function/policy that scoped by auth.uid() now
-- scopes by public.acting_workspace() and checks a minimum role.

CREATE TABLE public.workspace_members(
 workspace_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN('admin','manager','agent')),
 invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id),
 CHECK(workspace_id<>user_id)
);
CREATE INDEX workspace_members_user_idx ON public.workspace_members(user_id);

CREATE TABLE public.workspace_invites(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL CHECK(email=lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email)<=254),
 role text NOT NULL CHECK(role IN('admin','manager','agent')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 accepted_at timestamptz,
 revoked_at timestamptz
);
CREATE UNIQUE INDEX workspace_invites_open_email ON public.workspace_invites(workspace_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
-- No direct table access: everything goes through the RPCs below.
REVOKE ALL ON public.workspace_members,public.workspace_invites FROM PUBLIC,anon,authenticated;

-- Who did it: actor columns for audit and ticket history (NULL for rows written before 043).
ALTER TABLE public.owner_audit_events ADD COLUMN actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ticket_events ADD COLUMN actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Ticket assignment to a specific teammate (the legacy assigned_to_owner flag is kept).
ALTER TABLE public.support_cases ADD COLUMN assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE FUNCTION public.acting_workspace() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid:=auth.uid();h text;ws uuid;
BEGIN
 IF me IS NULL THEN RETURN NULL;END IF;
 h:=nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-workspace-id','');
 IF h IS NULL THEN RETURN me;END IF;
 BEGIN ws:=h::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;END;
 IF ws=me THEN RETURN me;END IF;
 IF EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=me) THEN RETURN ws;END IF;
 RETURN NULL;
END$$;

CREATE FUNCTION public.role_rank(p_role text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'manager' THEN 2 WHEN 'agent' THEN 1 ELSE 0 END
$$;

CREATE FUNCTION public.acting_role() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();r text;
BEGIN
 IF ws IS NULL THEN RETURN NULL;END IF;
 IF ws=auth.uid() THEN RETURN 'owner';END IF;
 SELECT role INTO r FROM workspace_members WHERE workspace_id=ws AND user_id=auth.uid();
 RETURN r;
END$$;

CREATE FUNCTION public.workspace_role_at_least(p_min text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.role_rank(public.acting_role())>=public.role_rank(p_min)
$$;

REVOKE ALL ON FUNCTION public.acting_workspace(),public.acting_role(),public.workspace_role_at_least(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acting_workspace(),public.acting_role(),public.workspace_role_at_least(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.role_rank(text) TO authenticated;

-- Seat cap per workspace (owner + members + open invites). Bounded preview limit, not a plan entitlement.
CREATE FUNCTION public.workspace_seat_count(p_ws uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT 1+(SELECT count(*) FROM workspace_members WHERE workspace_id=p_ws)::int
  +(SELECT count(*) FROM workspace_invites WHERE workspace_id=p_ws AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now())::int
$$;
REVOKE ALL ON FUNCTION public.workspace_seat_count(uuid) FROM PUBLIC,anon,authenticated;

-- Team changes use the existing audit vocabulary: resource + INSERT/UPDATE/DELETE.
CREATE FUNCTION public.audit_team(p_ws uuid,p_resource text,p_op text,p_rid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(p_ws,p_resource,p_op,p_rid,auth.uid())
$$;
REVOKE ALL ON FUNCTION public.audit_team(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;

-- Workspaces the caller can act in: their own plus memberships.
CREATE FUNCTION public.my_workspaces() RETURNS TABLE(workspace_id uuid,role text,owner_email text,joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT u.id,'owner',u.email::text,u.created_at FROM auth.users u WHERE u.id=auth.uid()
 UNION ALL
 SELECT m.workspace_id,m.role,o.email::text,m.created_at FROM workspace_members m JOIN auth.users o ON o.id=m.workspace_id WHERE m.user_id=auth.uid()
 ORDER BY 4
$$;

-- Current context, used by the server on every authenticated request.
CREATE FUNCTION public.workspace_context() RETURNS TABLE(workspace_id uuid,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.acting_workspace(),public.acting_role() WHERE public.acting_workspace() IS NOT NULL
$$;

-- Team roster for the acting workspace (any member may view teammates).
CREATE FUNCTION public.workspace_team() RETURNS TABLE(user_id uuid,email text,role text,joined_at timestamptz,is_you boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL THEN RAISE EXCEPTION 'Workspace unavailable';END IF;
 RETURN QUERY
  SELECT u.id,u.email::text,'owner'::text,u.created_at,u.id=auth.uid() FROM auth.users u WHERE u.id=ws
  UNION ALL
  SELECT m.user_id,u.email::text,m.role,m.created_at,m.user_id=auth.uid() FROM workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=ws
  ORDER BY 4;
END$$;

CREATE FUNCTION public.workspace_pending_invites() RETURNS TABLE(id uuid,email text,role text,created_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 RETURN QUERY SELECT i.id,i.email,i.role,i.created_at,i.expires_at FROM workspace_invites i
  WHERE i.workspace_id=ws AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() ORDER BY i.created_at DESC;
END$$;

-- You may only grant, change or remove roles strictly below your own (the owner may manage admins).
CREATE FUNCTION public.create_workspace_invite(p_email text,p_role text,p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();me text:=public.acting_role();e text:=lower(trim(p_email));rid uuid;
BEGIN
 IF ws IS NULL OR p_role NOT IN('admin','manager','agent') OR public.role_rank(p_role)>=public.role_rank(me) THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF e IS NULL OR e!~'^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(e)>254 OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid invite';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws::text,43));
 IF EXISTS(SELECT 1 FROM auth.users u WHERE u.id=ws AND lower(u.email)=e) OR EXISTS(SELECT 1 FROM workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id=ws AND lower(u.email)=e) THEN RAISE EXCEPTION 'Already a member';END IF;
 IF EXISTS(SELECT 1 FROM workspace_invites WHERE workspace_id=ws AND email=e AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'Invite already pending';END IF;
 UPDATE workspace_invites SET revoked_at=now() WHERE workspace_id=ws AND email=e AND accepted_at IS NULL AND revoked_at IS NULL;
 IF public.workspace_seat_count(ws)>=25 THEN RAISE EXCEPTION 'Seat limit reached';END IF;
 INSERT INTO workspace_invites(workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(ws,e,p_role,p_hash,auth.uid(),now()+interval '7 days') RETURNING id INTO rid;
 PERFORM public.audit_team(ws,'workspace_invites','INSERT',rid);
 RETURN rid;
END$$;

CREATE FUNCTION public.revoke_workspace_invite(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();r workspace_invites;
BEGIN
 IF ws IS NULL THEN RETURN false;END IF;
 SELECT * INTO r FROM workspace_invites WHERE id=p_id AND workspace_id=ws AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF public.role_rank(r.role)>=public.role_rank(public.acting_role()) THEN RAISE EXCEPTION 'Insufficient role';END IF;
 UPDATE workspace_invites SET revoked_at=now() WHERE id=p_id;
 PERFORM public.audit_team(ws,'workspace_invites','DELETE',p_id);
 RETURN true;
END$$;

-- The signed-in user's confirmed email must match the invited address.
CREATE FUNCTION public.accept_workspace_invite(p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid:=auth.uid();e text;r workspace_invites;
BEGIN
 IF me IS NULL OR p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invite unavailable';END IF;
 SELECT lower(email) INTO e FROM auth.users WHERE id=me AND email_confirmed_at IS NOT NULL;
 SELECT * INTO r FROM workspace_invites WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR r.accepted_at IS NOT NULL OR r.revoked_at IS NOT NULL OR r.expires_at<=now() OR e IS NULL OR r.email<>e OR r.workspace_id=me THEN RAISE EXCEPTION 'Invite unavailable';END IF;
 INSERT INTO workspace_members(workspace_id,user_id,role,invited_by) VALUES(r.workspace_id,me,r.role,r.invited_by) ON CONFLICT DO NOTHING;
 UPDATE workspace_invites SET accepted_at=now() WHERE id=r.id;
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(r.workspace_id,'workspace_members','INSERT',me,me);
 RETURN r.workspace_id;
END$$;

CREATE FUNCTION public.set_member_role(p_user uuid,p_role text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();me int:=public.role_rank(public.acting_role());cur text;
BEGIN
 IF ws IS NULL OR p_role NOT IN('admin','manager','agent') OR p_user=auth.uid() THEN RAISE EXCEPTION 'Invalid role change';END IF;
 SELECT role INTO cur FROM workspace_members WHERE workspace_id=ws AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF public.role_rank(cur)>=me OR public.role_rank(p_role)>=me THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF cur=p_role THEN RETURN true;END IF;
 UPDATE workspace_members SET role=p_role,updated_at=now() WHERE workspace_id=ws AND user_id=p_user;
 PERFORM public.audit_team(ws,'workspace_members','UPDATE',p_user);
 RETURN true;
END$$;

CREATE FUNCTION public.remove_member(p_user uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();cur text;
BEGIN
 IF ws IS NULL OR p_user=auth.uid() THEN RAISE EXCEPTION 'Use leave_workspace to leave';END IF;
 SELECT role INTO cur FROM workspace_members WHERE workspace_id=ws AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF public.role_rank(cur)>=public.role_rank(public.acting_role()) THEN RAISE EXCEPTION 'Insufficient role';END IF;
 DELETE FROM workspace_members WHERE workspace_id=ws AND user_id=p_user;
 UPDATE support_cases SET assignee_id=NULL WHERE user_id=ws AND assignee_id=p_user;
 PERFORM public.audit_team(ws,'workspace_members','DELETE',p_user);
 RETURN true;
END$$;

CREATE FUNCTION public.leave_workspace(p_workspace uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid:=auth.uid();
BEGIN
 IF me IS NULL OR p_workspace=me THEN RAISE EXCEPTION 'The owner cannot leave their own workspace';END IF;
 DELETE FROM workspace_members WHERE workspace_id=p_workspace AND user_id=me;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE support_cases SET assignee_id=NULL WHERE user_id=p_workspace AND assignee_id=me;
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(p_workspace,'workspace_members','DELETE',me,me);
 RETURN true;
END$$;

-- Assign a ticket to a teammate (or the owner), or clear it with NULL. Agents may assign.
CREATE FUNCTION public.assign_ticket(p_id uuid,p_assignee uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_assignee IS NOT NULL AND p_assignee<>ws AND NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=ws AND user_id=p_assignee) THEN RAISE EXCEPTION 'Assignee is not on this team';END IF;
 PERFORM 1 FROM support_cases WHERE id=p_id AND user_id=ws FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF (SELECT assignee_id FROM support_cases WHERE id=p_id) IS NOT DISTINCT FROM p_assignee THEN RETURN true;END IF;
 UPDATE support_cases SET assignee_id=p_assignee,assigned_to_owner=(p_assignee IS NOT NULL),first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_id;
 IF (SELECT count(*) FROM ticket_events WHERE case_id=p_id)<200 THEN
  INSERT INTO ticket_events(user_id,case_id,kind,body,actor_id) VALUES(ws,p_id,'owner_update',CASE WHEN p_assignee IS NULL THEN 'Assignment cleared' ELSE 'Assigned to '||(SELECT email FROM auth.users WHERE id=p_assignee) END,auth.uid());
 END IF;
 RETURN true;
END$$;

REVOKE ALL ON FUNCTION public.my_workspaces(),public.workspace_context(),public.workspace_team(),public.workspace_pending_invites(),
 public.create_workspace_invite(text,text,text),public.revoke_workspace_invite(uuid),public.accept_workspace_invite(text),
 public.set_member_role(uuid,text),public.remove_member(uuid),public.leave_workspace(uuid),public.assign_ticket(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_workspaces(),public.workspace_context(),public.workspace_team(),public.workspace_pending_invites(),
 public.create_workspace_invite(text,text,text),public.revoke_workspace_invite(uuid),public.accept_workspace_invite(text),
 public.set_member_role(uuid,text),public.remove_member(uuid),public.leave_workspace(uuid),public.assign_ticket(uuid,uuid) TO authenticated;

-- Triggers: record the actor and treat any member acting in the workspace as an owner-side write.
CREATE OR REPLACE FUNCTION public.record_owner_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE uid uuid;rid uuid;
BEGIN
 IF TG_OP='DELETE' THEN uid:=OLD.user_id;rid:=coalesce(to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'user_id')::uuid;ELSE uid:=NEW.user_id;rid:=coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'user_id')::uuid;END IF;
 -- Log successful workspace writes only, not anonymous visitor queries. Never copy payloads.
 IF public.acting_workspace()=uid THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,42));
  DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 999);
  INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(uid,TG_TABLE_NAME,TG_OP,rid,auth.uid());
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_ticket_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
 IF public.acting_workspace()=NEW.user_id AND ROW(NEW.ticket_status,NEW.priority,NEW.category,NEW.tags,NEW.assigned_to_owner,NEW.inbox_state) IS DISTINCT FROM ROW(OLD.ticket_status,OLD.priority,OLD.category,OLD.tags,OLD.assigned_to_owner,OLD.inbox_state) AND(SELECT count(*) FROM ticket_events WHERE case_id=NEW.id)<200 THEN
 INSERT INTO ticket_events(user_id,case_id,kind,body,actor_id) VALUES(NEW.user_id,NEW.id,'owner_update','State: '||NEW.ticket_status||'; priority: '||NEW.priority||'; category: '||NEW.category||'; assignee: '||CASE WHEN NEW.assigned_to_owner THEN 'assigned' ELSE 'unassigned' END||'; AI: '||NEW.inbox_state,auth.uid());
 END IF;RETURN NEW;
END;
$function$;

-- Workspace data deletion also removes the team (owner only; generated section adds the role gate).
-- === GENERATED: tenant resolver + role gates (do not hand-edit; regenerate from 001..042) ===
-- add_ticket_note: minimum role agent
CREATE OR REPLACE FUNCTION public.add_ticket_note(p_case uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid note';END IF;
 PERFORM 1 FROM support_cases WHERE id=p_case AND user_id=uid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Ticket unavailable';END IF;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=p_case)>=200 THEN RAISE EXCEPTION 'Ticket history limit reached';END IF;
 INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(uid,p_case,'internal_note',trim(p_body)) RETURNING id INTO rid;
 UPDATE support_cases SET first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_case;
 RETURN rid;
END;
$function$;

-- claim_demo_webhook: minimum role admin
CREATE OR REPLACE FUNCTION public.claim_demo_webhook()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e demo_webhook_events;w demo_webhooks;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO w FROM demo_webhooks WHERE user_id=public.acting_workspace() AND enabled=true;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE demo_webhook_events SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,next_at=now()+interval '1 minute' WHERE user_id=public.acting_workspace() AND status='sending' AND claimed_at<now()-interval '30 seconds';
 SELECT * INTO e FROM demo_webhook_events WHERE user_id=public.acting_workspace() AND webhook_id=w.id AND status='pending' AND attempts<3 AND next_at<=now() ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE demo_webhook_events SET status='sending',attempts=attempts+1,claimed_at=now() WHERE id=e.id;
 RETURN jsonb_build_object('id',e.id,'url',w.url,'secret',w.secret,'payload',e.payload,'attempt',e.attempts+1);
END;
$function$;

-- configure_demo_webhook: minimum role admin
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

-- create_readonly_token: minimum role admin
CREATE OR REPLACE FUNCTION public.create_readonly_token(p_label text, p_hash text, p_scope text, p_hours integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read','health:read') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=public.acting_workspace() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(public.acting_workspace(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$function$;

-- decide_ticket_review: minimum role manager
CREATE OR REPLACE FUNCTION public.decide_ticket_review(p_id uuid, p_decision text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();r support_cases;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_decision IS NULL OR p_decision NOT IN('pending','approved','rejected') THEN RAISE EXCEPTION 'Invalid decision';END IF;
 SELECT * INTO r FROM support_cases WHERE id=p_id AND user_id=uid FOR UPDATE;IF NOT FOUND OR r.category<>'refund' THEN RAISE EXCEPTION 'Refund review unavailable';END IF;
 IF r.review_decision=p_decision THEN RETURN true;END IF;
 IF p_decision IN('approved','rejected') AND r.review_decision<>'pending' OR p_decision='pending' AND r.review_decision='pending' THEN RAISE EXCEPTION 'Request review before recording a decision';END IF;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=p_id)>=200 THEN RAISE EXCEPTION 'History limit reached';END IF;
 PERFORM set_config('automatepal.review_decision','true',true);
 UPDATE support_cases SET review_decision=p_decision,ticket_updated_at=clock_timestamp(),first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()) WHERE id=p_id;
 PERFORM set_config('automatepal.review_decision','false',true);
 INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(uid,p_id,'owner_update','Owner refund-review decision: '||p_decision||'. Metadata only; no money execution authorized or performed.');RETURN true;
END;
$function$;

-- delete_knowledge_source: minimum role manager
CREATE OR REPLACE FUNCTION public.delete_knowledge_source(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 IF NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=p_id AND user_id=uid) THEN RETURN false;END IF;
 DELETE FROM knowledge_attempts WHERE source_id=p_id AND user_id=uid;
 DELETE FROM knowledge_documents WHERE id=p_id AND user_id=uid;
 RETURN true;
END;
$function$;

-- delete_preview_data: minimum role owner
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

-- fail_knowledge_attempt: minimum role manager
CREATE OR REPLACE FUNCTION public.fail_knowledge_attempt(p_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_status NOT IN('failed','limit_reached') THEN RAISE EXCEPTION 'Invalid attempt status';END IF;
 UPDATE knowledge_attempts SET status=p_status,finished_at=clock_timestamp() WHERE id=p_id AND user_id=public.acting_workspace() AND status='processing';RETURN FOUND;
END;
$function$;

-- finish_demo_webhook: minimum role admin
CREATE OR REPLACE FUNCTION public.finish_demo_webhook(p_id uuid, p_status integer, p_attempt integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 UPDATE demo_webhook_events SET status=CASE WHEN p_status BETWEEN 200 AND 299 THEN 'delivered' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,last_status=p_status,delivered_at=CASE WHEN p_status BETWEEN 200 AND 299 THEN now() ELSE NULL END,next_at=now()+CASE WHEN attempts=1 THEN interval '1 minute' ELSE interval '5 minutes' END WHERE id=p_id AND user_id=public.acting_workspace() AND status='sending' AND attempts=p_attempt;RETURN FOUND;
END;
$function$;

-- operational_summary: minimum role manager
CREATE OR REPLACE FUNCTION public.operational_summary(p_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid;r jsonb;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_hash IS NULL THEN uid:=public.acting_workspace();ELSE SELECT user_id INTO uid FROM readonly_tokens WHERE token_hash=p_hash AND scope='health:read' AND revoked_at IS NULL AND expires_at>now();END IF;
 IF uid IS NULL THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM(SELECT code,severity,component,count(*) AS count,max(created_at) AS latest FROM operational_events WHERE user_id=uid AND created_at>=now()-interval '24 hours' GROUP BY code,severity,component)x;
 RETURN jsonb_build_object('asOf',now(),'windowHours',24,'groups',r,'coverage','Instrumented ticket/owner/alert paths only; latest 500 retained rows. Not all exceptions are captured. Logging is best effort and may fail with the database. No events does not prove health.','dependencyProbe','database query succeeded; model/provider not probed','automatedRecovery','ticket-list transient DB connection/capacity failure: one read retry after 250ms; no automatic writes or deploy rollback');
END;
$function$;

-- proof_claim_operation: minimum role admin
CREATE OR REPLACE FUNCTION public.proof_claim_operation(p_contract uuid, p_action uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.proof_contracts WHERE id=p_contract AND user_id=public.acting_workspace()) OR NOT EXISTS(
  SELECT 1 FROM public.action_proposals WHERE id=p_action AND user_id=public.acting_workspace() AND status='executing'
  AND tool IN('proof_create_order','proof_authorize','proof_capture','proof_void') AND args->>'contractId'=p_contract::text
 ) THEN RAISE EXCEPTION 'Reviewed executing proof action required'; END IF;
 INSERT INTO public.proof_operation_locks(contract_id,user_id,action_id) VALUES(p_contract,public.acting_workspace(),p_action) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END;
$function$;

-- proof_finish_operation: minimum role admin
CREATE OR REPLACE FUNCTION public.proof_finish_operation(p_contract uuid, p_action uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 DELETE FROM public.proof_operation_locks WHERE contract_id=p_contract AND action_id=p_action AND user_id=public.acting_workspace();
 RETURN FOUND;
END;
$function$;

-- record_operational_event: minimum role agent
CREATE OR REPLACE FUNCTION public.record_operational_event(p_request uuid, p_code text, p_severity text, p_component text, p_release text, p_attempt smallint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,91));
 IF EXISTS(SELECT 1 FROM operational_events WHERE user_id=uid AND request_id=p_request AND code=p_code AND attempt=p_attempt) THEN RETURN true;END IF;
 DELETE FROM operational_events WHERE user_id=uid AND created_at<now()-interval '7 days';
 DELETE FROM operational_events WHERE id IN(SELECT id FROM operational_events WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 499);
 INSERT INTO operational_events(user_id,request_id,code,severity,component,release,attempt) VALUES(uid,p_request,p_code,p_severity,p_component,p_release,p_attempt);RETURN true;
END;
$function$;

-- record_owner_alert_check: minimum role manager
CREATE OR REPLACE FUNCTION public.record_owner_alert_check(p_eligible integer, p_state text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_eligible NOT BETWEEN 0 AND 200 OR p_state NOT IN('dry_run','quiet_hours','digest_only') THEN RAISE EXCEPTION 'Invalid check';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,85));
 IF EXISTS(SELECT 1 FROM owner_alert_checks WHERE user_id=uid AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Check already recorded this minute';END IF;
 DELETE FROM owner_alert_checks WHERE id IN(SELECT id FROM owner_alert_checks WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 99);
 INSERT INTO owner_alert_checks(user_id,eligible,state) VALUES(uid,p_eligible,p_state) RETURNING id INTO rid;RETURN rid;
END;
$function$;

-- reserve_catalog_ai: minimum role admin
CREATE OR REPLACE FUNCTION public.reserve_catalog_ai()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();n integer;d date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,97));
 INSERT INTO catalog_ai_budget(user_id,utc_day,attempts) VALUES(uid,d,0) ON CONFLICT(user_id) DO NOTHING;
 UPDATE catalog_ai_budget SET utc_day=d,attempts=0 WHERE user_id=uid AND utc_day<>d;
 UPDATE catalog_ai_budget SET attempts=attempts+1 WHERE user_id=uid AND attempts<10 RETURNING attempts INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'Daily catalog question budget reached';END IF;
 RETURN n;
END;
$function$;

-- revoke_readonly_token: minimum role admin
CREATE OR REPLACE FUNCTION public.revoke_readonly_token(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF; UPDATE readonly_tokens SET revoked_at=now() WHERE id=p_id AND user_id=public.acting_workspace() AND revoked_at IS NULL;RETURN FOUND;END;
$function$;

-- save_custom_response: minimum role manager
CREATE OR REPLACE FUNCTION public.save_custom_response(p_id uuid, p_expected timestamp with time zone, p_question text, p_answer text, p_published boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();r public.custom_responses;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR length(btrim(p_question)) NOT BETWEEN 3 AND 300 OR length(btrim(p_answer)) NOT BETWEEN 10 AND 5000 OR p_published IS NULL THEN RAISE EXCEPTION 'Invalid custom response';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 SELECT * INTO r FROM public.custom_responses WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF r.user_id<>uid OR p_expected IS NULL OR r.updated_at<>p_expected THEN RAISE EXCEPTION 'Response changed or unavailable';END IF;
 ELSIF p_expected IS NOT NULL THEN RAISE EXCEPTION 'Response changed or unavailable';
 ELSIF(SELECT count(*) FROM public.custom_responses WHERE user_id=uid)>=30 THEN RAISE EXCEPTION 'Custom response limit: 30';END IF;
 INSERT INTO public.custom_responses(id,user_id,question,answer,published,updated_at) VALUES(p_id,uid,btrim(p_question),btrim(p_answer),p_published,clock_timestamp()) ON CONFLICT(id) DO UPDATE SET question=excluded.question,answer=excluded.answer,published=excluded.published,updated_at=excluded.updated_at;
 RETURN p_id;
END;
$function$;

-- save_guidance_attempt: minimum role manager
CREATE OR REPLACE FUNCTION public.save_guidance_attempt(p_attempt uuid, p_id uuid, p_expected timestamp with time zone, p_title text, p_content text, p_published boolean, p_chunks jsonb, p_metadata jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r uuid;k text:=p_metadata->>'sourceKind';a text:=coalesce(p_metadata->>'applicability','');f date;u date;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR k IS NULL OR k NOT IN('text','owner_guidance') THEN RAISE EXCEPTION 'Invalid source type';END IF;
 IF k='owner_guidance' THEN
  f:=(p_metadata->>'effectiveFrom')::date;u:=(p_metadata->>'effectiveUntil')::date;
  IF length(trim(a)) NOT BETWEEN 10 AND 500 OR f IS NULL OR u IS NULL OR u<f THEN RAISE EXCEPTION 'Guidance needs scope and valid dates';END IF;
 ELSE a:='';END IF;
 r:=public.save_knowledge_attempt(p_attempt,p_id,p_expected,p_title,p_content,p_published,p_chunks);
 UPDATE public.knowledge_documents SET source_kind=k,applicability=a,effective_from=f,effective_until=u WHERE id=r AND user_id=public.acting_workspace();
 RETURN r;
END;
$function$;

-- save_knowledge_attempt: minimum role manager
CREATE OR REPLACE FUNCTION public.save_knowledge_attempt(p_attempt uuid, p_id uuid, p_expected timestamp with time zone, p_title text, p_content text, p_published boolean, p_chunks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 PERFORM 1 FROM knowledge_attempts WHERE id=p_attempt AND user_id=public.acting_workspace() AND source_id=p_id AND status='processing' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import attempt unavailable';END IF;
 r:=public.save_knowledge_source(p_id,p_expected,p_title,p_content,p_published,p_chunks);
 UPDATE knowledge_attempts SET status='success',finished_at=clock_timestamp() WHERE id=p_attempt;RETURN r;
END;
$function$;

-- save_knowledge_source: minimum role manager
CREATE OR REPLACE FUNCTION public.save_knowledge_source(p_id uuid, p_expected timestamp with time zone, p_title text, p_content text, p_published boolean, p_chunks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE uid uuid:=public.acting_workspace();existing public.knowledge_documents;pages integer;cnt integer;item jsonb;pos integer:=0;
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
 IF cnt>=30 OR pages+ceil(length(p_content)::numeric/2500)>360 THEN RAISE EXCEPTION 'Preview quota reached: 30 sources or 360 page units';END IF;
 INSERT INTO public.knowledge_documents(id,user_id,title,content,published,updated_at) VALUES(p_id,uid,p_title,p_content,p_published,clock_timestamp()) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,published=excluded.published,updated_at=excluded.updated_at;
 DELETE FROM public.knowledge_chunks WHERE document_id=p_id AND user_id=uid;
 FOR item IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP
  IF jsonb_typeof(item->'embedding') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'embedding')<>768 OR length(item->>'content') NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'Invalid chunks';END IF;
  INSERT INTO public.knowledge_chunks(id,document_id,user_id,position,content,embedding) VALUES(gen_random_uuid(),p_id,uid,pos,item->>'content',(item->'embedding')::text::extensions.vector(768));pos:=pos+1;
 END LOOP;
 RETURN p_id;
END;
$function$;

-- set_support_inbox: minimum role agent
CREATE OR REPLACE FUNCTION public.set_support_inbox(p_id uuid, p_state text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r support_cases;v text;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_state NOT IN('open','taken_over','closed') THEN RAISE EXCEPTION 'Invalid state';END IF;
 SELECT * INTO r FROM support_cases WHERE id=p_id AND user_id=public.acting_workspace() FOR UPDATE;IF NOT FOUND THEN RETURN false;END IF;
 v:=CASE p_state WHEN 'closed' THEN CASE WHEN r.ticket_status IN('resolved','closed') THEN 'closed' ELSE 'resolved' END WHEN 'taken_over' THEN 'pending' ELSE 'open' END;
 IF p_state='closed' AND r.ticket_status='new' THEN UPDATE support_cases SET ticket_status='open' WHERE id=p_id;END IF;
 UPDATE support_cases SET inbox_state=p_state,ticket_status=v,first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_id;RETURN true;
END;
$function$;

-- start_knowledge_attempt: minimum role manager
CREATE OR REPLACE FUNCTION public.start_knowledge_attempt(p_source uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_source IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 IF EXISTS(SELECT 1 FROM knowledge_documents WHERE id=p_source AND user_id<>uid) THEN RAISE EXCEPTION 'Source unavailable';END IF;
 IF(SELECT count(*) FROM knowledge_attempts WHERE user_id=uid AND status='processing' AND started_at>now()-interval '5 minutes')>=3 THEN RAISE EXCEPTION 'Too many active imports';END IF;
 DELETE FROM knowledge_attempts WHERE id IN(SELECT id FROM knowledge_attempts WHERE user_id=uid ORDER BY started_at DESC OFFSET 99);
 INSERT INTO knowledge_attempts(user_id,source_id) VALUES(uid,p_source) RETURNING id INTO rid;RETURN rid;
END;
$function$;

-- support_review_request: minimum role agent
CREATE OR REPLACE FUNCTION public.support_review_request(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 UPDATE public.support_requests SET status='reviewed_no_action' WHERE id=p_id AND user_id=public.acting_workspace() AND status='pending_review';
 RETURN FOUND;
END;
$function$;

-- update_service_ticket: minimum role agent
CREATE OR REPLACE FUNCTION public.update_service_ticket(p_id uuid, p_type text, p_impact smallint, p_urgency smallint, p_queue text, p_related uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();r support_cases;pr text;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_type NOT IN('incident','service_request','question') OR p_impact NOT BETWEEN 1 AND 3 OR p_urgency NOT BETWEEN 1 AND 3 OR p_queue NOT IN('general','technical','billing','knowledge') OR p_type IS NULL OR p_impact IS NULL OR p_urgency IS NULL OR p_queue IS NULL THEN RAISE EXCEPTION 'Invalid service fields';END IF;
 SELECT * INTO r FROM support_cases WHERE id=p_id AND user_id=uid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Ticket unavailable';END IF;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=p_id)>197 THEN RAISE EXCEPTION 'History limit reached';END IF;
 -- 1=highest, 3=lowest. Explicit nine-cell matrix, no predictive severity claim.
 pr:=CASE WHEN p_impact+p_urgency<=3 THEN 'urgent' WHEN p_impact+p_urgency=4 THEN 'high' WHEN p_impact+p_urgency=5 THEN 'normal' ELSE 'low' END;
 IF ROW(r.ticket_type,r.impact,r.urgency,r.assignment_queue,r.related_ticket,r.priority) IS NOT DISTINCT FROM ROW(p_type,p_impact,p_urgency,p_queue,p_related,pr) THEN RETURN true;END IF;
 UPDATE support_cases SET ticket_type=p_type,impact=p_impact,urgency=p_urgency,assignment_queue=p_queue,related_ticket=p_related,priority=pr,first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(uid,p_id,'owner_update','Service fields: '||p_type||'; impact '||p_impact||'; urgency '||p_urgency||'; queue '||p_queue||'; computed priority '||pr||'; related '||coalesce(p_related::text,'none'));
 RETURN true;
END;
$function$;

-- update_tickets: minimum role agent
CREATE OR REPLACE FUNCTION public.update_tickets(p_ids uuid[], p_patch jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();r support_cases;n integer:=0;t text;v text;summary text;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('agent') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 50 OR p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN('status','priority','category','tags','assigned','takeover')) THEN RAISE EXCEPTION 'Invalid ticket update';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 IF (SELECT count(*) FROM support_cases WHERE id=ANY(p_ids) AND user_id=uid)<>cardinality(p_ids) THEN RAISE EXCEPTION 'Ticket unavailable or duplicate';END IF;
 IF p_patch?'status' AND (p_patch->>'status' IS NULL OR p_patch->>'status' NOT IN('new','open','pending','resolved','closed')) OR p_patch?'priority' AND (p_patch->>'priority' IS NULL OR p_patch->>'priority' NOT IN('low','normal','high','urgent')) OR p_patch?'category' AND (p_patch->>'category' IS NULL OR p_patch->>'category' NOT IN('general','billing','refund','receipt','handoff','knowledge')) THEN RAISE EXCEPTION 'Invalid fields';END IF;
 IF p_patch?'assigned' AND jsonb_typeof(p_patch->'assigned')<>'boolean' OR p_patch?'takeover' AND jsonb_typeof(p_patch->'takeover')<>'boolean' THEN RAISE EXCEPTION 'Invalid flags';END IF;
 IF p_patch?'tags' THEN
  IF jsonb_typeof(p_patch->'tags')<>'array' OR jsonb_array_length(p_patch->'tags')>8 THEN RAISE EXCEPTION 'Invalid tags';END IF;
  FOR t IN SELECT jsonb_array_elements_text(p_patch->'tags') LOOP IF t IS NULL OR t!~'^[A-Za-z0-9_-]{1,24}$' THEN RAISE EXCEPTION 'Invalid tag';END IF;END LOOP;
 END IF;
 -- Only fixed field names/validated metadata in history, not request text or credentials.
 summary:='Owner updated '||(SELECT string_agg(k,', ' ORDER BY k) FROM jsonb_object_keys(p_patch) k);
 FOR r IN SELECT * FROM support_cases WHERE user_id=uid AND id=ANY(p_ids) ORDER BY id FOR UPDATE LOOP
  IF(SELECT count(*) FROM ticket_events WHERE case_id=r.id)>=200 THEN RAISE EXCEPTION 'Ticket history limit reached';END IF;
  v:=coalesce(p_patch->>'status',r.ticket_status);
  UPDATE support_cases SET ticket_status=v,priority=coalesce(p_patch->>'priority',priority),category=coalesce(p_patch->>'category',category),tags=coalesce(p_patch->'tags',tags),assigned_to_owner=coalesce((p_patch->>'assigned')::boolean,assigned_to_owner),first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp(),
   inbox_state=CASE WHEN v IN('resolved','closed') THEN 'closed' WHEN p_patch?'takeover' THEN CASE WHEN (p_patch->>'takeover')::boolean THEN 'taken_over' ELSE 'open' END WHEN inbox_state='closed' THEN 'open' ELSE inbox_state END WHERE id=r.id;
  INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(uid,r.id,'owner_update',summary);n:=n+1;
 END LOOP;
 RETURN n;
END;
$function$;

-- 25 functions regenerated.

-- === END GENERATED ===

-- Actor stamping for history rows written by any path (visitor-side writes keep NULL).
CREATE FUNCTION public.stamp_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.actor_id IS NULL AND public.acting_workspace()=NEW.user_id THEN NEW.actor_id:=auth.uid();END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.stamp_actor() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ticket_events_actor BEFORE INSERT ON public.ticket_events FOR EACH ROW EXECUTE FUNCTION public.stamp_actor();
CREATE TRIGGER owner_audit_events_actor BEFORE INSERT ON public.owner_audit_events FOR EACH ROW EXECUTE FUNCTION public.stamp_actor();

-- RLS: workspace scoping plus a minimum role per table and command.
-- (select ...) wrappers let Postgres evaluate the resolver once per statement.
DROP POLICY own_actions ON public.action_proposals;
CREATE POLICY ws_actions ON public.action_proposals FOR ALL TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')))
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_events ON public.billing_events;
CREATE POLICY ws_events_read ON public.billing_events FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
CREATE POLICY ws_events_write ON public.billing_events FOR INSERT TO authenticated
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_catalog_ai_budget ON public.catalog_ai_budget;
CREATE POLICY ws_catalog_ai_budget ON public.catalog_ai_budget FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_custom_responses ON public.custom_responses;
DROP POLICY delete_own_custom_responses ON public.custom_responses;
CREATE POLICY ws_custom_responses ON public.custom_responses FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
CREATE POLICY ws_delete_custom_responses ON public.custom_responses FOR DELETE TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));

DROP POLICY own_webhook_events ON public.demo_webhook_events;
CREATE POLICY ws_webhook_events ON public.demo_webhook_events FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));
DROP POLICY own_webhooks ON public.demo_webhooks;
CREATE POLICY ws_webhooks ON public.demo_webhooks FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_attempts ON public.knowledge_attempts;
CREATE POLICY ws_attempts ON public.knowledge_attempts FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));

DROP POLICY own_chunks ON public.knowledge_chunks;
DROP POLICY insert_own_chunks ON public.knowledge_chunks;
CREATE POLICY ws_chunks ON public.knowledge_chunks FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
CREATE POLICY ws_insert_chunks ON public.knowledge_chunks FOR INSERT TO authenticated
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager'))
  AND EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.id=knowledge_chunks.document_id AND d.user_id=(select public.acting_workspace())));

DROP POLICY own_knowledge ON public.knowledge_documents;
CREATE POLICY ws_knowledge_read ON public.knowledge_documents FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
CREATE POLICY ws_knowledge_write ON public.knowledge_documents FOR ALL TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')))
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));

DROP POLICY own_knowledge_interactions ON public.knowledge_interactions;
CREATE POLICY ws_knowledge_interactions ON public.knowledge_interactions FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));

DROP POLICY own_operational_events ON public.operational_events;
CREATE POLICY ws_operational_events ON public.operational_events FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')) AND created_at>=now()-interval '7 days');

DROP POLICY own_alert_checks ON public.owner_alert_checks;
CREATE POLICY ws_alert_checks ON public.owner_alert_checks FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
DROP POLICY own_alert_preferences ON public.owner_alert_preferences;
CREATE POLICY ws_alert_preferences ON public.owner_alert_preferences FOR ALL TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')))
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));

DROP POLICY own_audit_events ON public.owner_audit_events;
CREATE POLICY ws_audit_events ON public.owner_audit_events FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_proof_assessments ON public.proof_assessments;
CREATE POLICY ws_proof_assessments ON public.proof_assessments FOR ALL TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')))
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin'))
  AND EXISTS(SELECT 1 FROM public.proof_contracts c WHERE c.id=proof_assessments.contract_id AND c.user_id=(select public.acting_workspace())));
DROP POLICY own_proof_contracts ON public.proof_contracts;
CREATE POLICY ws_proof_contracts ON public.proof_contracts FOR ALL TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')))
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));
DROP POLICY own_proof_locks ON public.proof_operation_locks;
CREATE POLICY ws_proof_locks ON public.proof_operation_locks FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_readonly_tokens ON public.readonly_tokens;
CREATE POLICY ws_readonly_tokens ON public.readonly_tokens FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));

DROP POLICY own_support_cases ON public.support_cases;
DROP POLICY create_support_cases ON public.support_cases;
CREATE POLICY ws_support_cases ON public.support_cases FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
CREATE POLICY ws_create_support_cases ON public.support_cases FOR INSERT TO authenticated
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));

DROP POLICY own_support_requests ON public.support_requests;
CREATE POLICY ws_support_requests ON public.support_requests FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));

DROP POLICY own_ticket_events ON public.ticket_events;
CREATE POLICY ws_ticket_events ON public.ticket_events FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));

DROP POLICY own_widget_settings ON public.widget_settings;
CREATE POLICY ws_widget_settings_read ON public.widget_settings FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
CREATE POLICY ws_widget_settings_write ON public.widget_settings FOR ALL TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')))
 WITH CHECK(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('manager')));
