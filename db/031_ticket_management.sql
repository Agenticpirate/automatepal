-- One ticket per existing fictional capability case. No customer email/reply channel.
ALTER TABLE public.support_cases
 ADD COLUMN ticket_status text NOT NULL DEFAULT 'new' CHECK(ticket_status IN('new','open','pending','resolved','closed')),
 ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high','urgent')),
 ADD COLUMN category text NOT NULL DEFAULT 'general' CHECK(category IN('general','billing','refund','receipt','handoff','knowledge')),
 ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=8),
 ADD COLUMN assigned_to_owner boolean NOT NULL DEFAULT false,
 ADD COLUMN first_reviewed_at timestamptz,
 ADD COLUMN ticket_updated_at timestamptz NOT NULL DEFAULT now();
UPDATE public.support_cases SET ticket_status=CASE inbox_state WHEN 'closed' THEN 'closed' WHEN 'taken_over' THEN 'pending' WHEN 'attention' THEN 'open' ELSE 'new' END;
CREATE TABLE public.ticket_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 kind text NOT NULL CHECK(kind IN('internal_note','owner_update','auto_escalation')),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000)
);
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_ticket_events ON public.ticket_events FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.ticket_events TO authenticated;
CREATE INDEX ticket_events_case_time ON public.ticket_events(user_id,case_id,created_at);
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.ticket_events FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();
CREATE FUNCTION public.update_tickets(p_ids uuid[],p_patch jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();r support_cases;n integer:=0;t text;v text;summary text;
BEGIN
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
$$;
CREATE FUNCTION public.add_ticket_note(p_case uuid,p_body text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();rid uuid;
BEGIN
 IF uid IS NULL OR p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid note';END IF;
 PERFORM 1 FROM support_cases WHERE id=p_case AND user_id=uid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Ticket unavailable';END IF;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=p_case)>=200 THEN RAISE EXCEPTION 'Ticket history limit reached';END IF;
 INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(uid,p_case,'internal_note',trim(p_body)) RETURNING id INTO rid;
 UPDATE support_cases SET first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_case;
 RETURN rid;
END;
$$;
CREATE FUNCTION public.escalate_ticket() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE reason text;cat text;
BEGIN
 IF TG_TABLE_NAME='support_requests' THEN reason:=NEW.kind;cat:=CASE NEW.kind WHEN 'refund_request' THEN 'refund' WHEN 'receipt_request' THEN 'receipt' WHEN 'human_handoff' THEN 'handoff' WHEN 'billing_question' THEN 'billing' ELSE 'general' END;
 ELSE
  IF NEW.feedback=-1 AND (OLD.feedback IS DISTINCT FROM -1) THEN reason:='negative_feedback';
  ELSIF NEW.supported=false AND current_setting('automatepal.answer_completion',true)='true' THEN reason:='unanswered_question';
  ELSE RETURN NEW;END IF;cat:='knowledge';
 END IF;
 UPDATE support_cases SET ticket_status=CASE WHEN ticket_status IN('new','resolved','closed') THEN 'open' ELSE ticket_status END,category=cat,ticket_updated_at=clock_timestamp(),inbox_state=CASE WHEN inbox_state='taken_over' THEN 'taken_over' ELSE 'attention' END WHERE id=NEW.case_id;
 INSERT INTO ticket_events(user_id,case_id,kind,body) SELECT NEW.user_id,NEW.case_id,'auto_escalation',reason WHERE(SELECT count(*) FROM ticket_events WHERE case_id=NEW.case_id)<200;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ticket_request_escalation AFTER INSERT ON public.support_requests FOR EACH ROW EXECUTE FUNCTION public.escalate_ticket();
CREATE TRIGGER ticket_feedback_escalation AFTER UPDATE ON public.knowledge_interactions FOR EACH ROW EXECUTE FUNCTION public.escalate_ticket();
CREATE OR REPLACE FUNCTION public.support_finish_knowledge(p_hash text,p_id uuid,p_supported boolean,p_count integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;done boolean;
BEGIN
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RETURN false;END IF;
 PERFORM set_config('automatepal.answer_completion','true',true);
 UPDATE knowledge_interactions SET supported=p_supported,source_count=p_count WHERE id=p_id AND case_id=c.id;
 done:=FOUND;PERFORM set_config('automatepal.answer_completion','false',true);RETURN done;
END;
$$;
-- Keep old handoff controls synchronized for existing clients.
CREATE OR REPLACE FUNCTION public.set_support_inbox(p_id uuid,p_state text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR p_state NOT IN('open','taken_over','closed') THEN RAISE EXCEPTION 'Invalid state';END IF;
 UPDATE support_cases SET inbox_state=p_state,ticket_status=CASE p_state WHEN 'closed' THEN 'closed' WHEN 'taken_over' THEN 'pending' ELSE 'open' END,first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_id AND user_id=auth.uid();RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.update_tickets(uuid[],jsonb),public.add_ticket_note(uuid,text),public.escalate_ticket() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_tickets(uuid[],jsonb),public.add_ticket_note(uuid,text) TO authenticated;
