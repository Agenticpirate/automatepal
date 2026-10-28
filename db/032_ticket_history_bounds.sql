-- Guard direct capability use too; never depend only on app validation.
CREATE OR REPLACE FUNCTION public.support_reserve_knowledge(p_hash text,p_question text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;
BEGIN
 IF p_question IS NULL OR length(trim(p_question)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Invalid question';END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RAISE EXCEPTION 'AI paused: case taken over, closed or expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,0));
 IF(SELECT count(*) FROM knowledge_interactions WHERE case_id=c.id)>=20 OR (SELECT count(*) FROM knowledge_interactions WHERE user_id=c.user_id AND created_at>=date_trunc('day',now()))>=100 THEN RAISE EXCEPTION 'Demo question budget reached';END IF;
 INSERT INTO knowledge_interactions(user_id,case_id,question,supported,source_count) VALUES(c.user_id,c.id,p_question,false,0) RETURNING id INTO rid;RETURN rid;
END;
$$;
-- Timeline status summary is reproducible, bounded and owner-only.
CREATE OR REPLACE FUNCTION public.record_ticket_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid()=NEW.user_id AND ROW(NEW.ticket_status,NEW.priority,NEW.category,NEW.tags,NEW.assigned_to_owner,NEW.inbox_state) IS DISTINCT FROM ROW(OLD.ticket_status,OLD.priority,OLD.category,OLD.tags,OLD.assigned_to_owner,OLD.inbox_state) AND(SELECT count(*) FROM ticket_events WHERE case_id=NEW.id)<200 THEN
 INSERT INTO ticket_events(user_id,case_id,kind,body) VALUES(NEW.user_id,NEW.id,'owner_update','State: '||NEW.ticket_status||'; priority: '||NEW.priority||'; category: '||NEW.category||'; assignee: '||CASE WHEN NEW.assigned_to_owner THEN 'owner' ELSE 'unassigned' END||'; AI: '||NEW.inbox_state);
 END IF;RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_ticket_state() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ticket_state AFTER UPDATE ON public.support_cases FOR EACH ROW EXECUTE FUNCTION public.record_ticket_state();
