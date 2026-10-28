-- Keep old handoff buttons compatible with the guarded service workflow.
-- Resolve pauses AI but uses resolved first; a second close may enter closed.
CREATE OR REPLACE FUNCTION public.set_support_inbox(p_id uuid,p_state text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r support_cases;v text;
BEGIN
 IF auth.uid() IS NULL OR p_state NOT IN('open','taken_over','closed') THEN RAISE EXCEPTION 'Invalid state';END IF;
 SELECT * INTO r FROM support_cases WHERE id=p_id AND user_id=auth.uid() FOR UPDATE;IF NOT FOUND THEN RETURN false;END IF;
 v:=CASE p_state WHEN 'closed' THEN CASE WHEN r.ticket_status IN('resolved','closed') THEN 'closed' ELSE 'resolved' END WHEN 'taken_over' THEN 'pending' ELSE 'open' END;
 IF p_state='closed' AND r.ticket_status='new' THEN UPDATE support_cases SET ticket_status='open' WHERE id=p_id;END IF;
 UPDATE support_cases SET inbox_state=p_state,ticket_status=v,first_reviewed_at=coalesce(first_reviewed_at,clock_timestamp()),ticket_updated_at=clock_timestamp() WHERE id=p_id;RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_support_inbox(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_support_inbox(uuid,text) TO authenticated;
