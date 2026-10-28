CREATE FUNCTION public.bound_ticket_events() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM support_cases WHERE id=NEW.case_id FOR UPDATE;
 IF(SELECT count(*) FROM ticket_events WHERE case_id=NEW.case_id)>=200 THEN RETURN NULL;END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bound_ticket_events() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bound_ticket_events BEFORE INSERT ON public.ticket_events FOR EACH ROW EXECUTE FUNCTION public.bound_ticket_events();
