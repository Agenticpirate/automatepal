-- Bounded service-management behaviors, not a branded product or parity claim.
ALTER TABLE support_cases
 ADD COLUMN ticket_type text NOT NULL DEFAULT 'question' CHECK(ticket_type IN('incident','service_request','question')),
 ADD COLUMN impact smallint NOT NULL DEFAULT 3 CHECK(impact BETWEEN 1 AND 3),
 ADD COLUMN urgency smallint NOT NULL DEFAULT 2 CHECK(urgency BETWEEN 1 AND 3),
 ADD COLUMN assignment_queue text NOT NULL DEFAULT 'general' CHECK(assignment_queue IN('general','technical','billing','knowledge')),
 ADD COLUMN review_decision text NOT NULL DEFAULT 'not_requested' CHECK(review_decision IN('not_requested','pending','approved','rejected')),
 ADD COLUMN related_ticket uuid REFERENCES support_cases(id) ON DELETE SET NULL;
CREATE FUNCTION service_ticket_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.review_decision<>'not_requested' THEN RAISE EXCEPTION 'Initial review must be not requested';END IF;
 IF NEW.related_ticket IS NOT NULL AND (NEW.related_ticket=NEW.id OR NOT EXISTS(SELECT 1 FROM support_cases WHERE id=NEW.related_ticket AND user_id=NEW.user_id)) THEN RAISE EXCEPTION 'Related ticket unavailable';END IF;
 IF TG_OP='UPDATE' AND NEW.ticket_status<>OLD.ticket_status AND NOT (
 OLD.ticket_status='new' AND NEW.ticket_status IN('open','pending') OR
 OLD.ticket_status='open' AND NEW.ticket_status IN('pending','resolved') OR
 OLD.ticket_status='pending' AND NEW.ticket_status IN('open','resolved') OR
 OLD.ticket_status='resolved' AND NEW.ticket_status IN('open','closed') OR
 OLD.ticket_status='closed' AND NEW.ticket_status='open') THEN RAISE EXCEPTION 'Invalid transition: use new/open/pending/resolved/closed workflow';END IF;
 IF TG_OP='UPDATE' AND NEW.ticket_status IN('resolved','closed') AND OLD.ticket_status<>NEW.ticket_status AND NEW.category='refund' AND NEW.review_decision NOT IN('approved','rejected') THEN RAISE EXCEPTION 'Record owner review decision before resolving refund';END IF;
 IF TG_OP='UPDATE' AND OLD.review_decision IS DISTINCT FROM NEW.review_decision AND current_setting('automatepal.review_decision',true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Use owner review action';END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION service_ticket_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER service_ticket_guard BEFORE INSERT OR UPDATE ON support_cases FOR EACH ROW EXECUTE FUNCTION service_ticket_guard();
CREATE FUNCTION update_service_ticket(p_id uuid,p_type text,p_impact smallint,p_urgency smallint,p_queue text,p_related uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();r support_cases;pr text;
BEGIN
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
$$;
CREATE FUNCTION decide_ticket_review(p_id uuid,p_decision text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();r support_cases;
BEGIN
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
$$;
REVOKE ALL ON FUNCTION update_service_ticket(uuid,text,smallint,smallint,text,uuid),decide_ticket_review(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION update_service_ticket(uuid,text,smallint,smallint,text,uuid),decide_ticket_review(uuid,text) TO authenticated;
