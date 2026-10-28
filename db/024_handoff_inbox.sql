ALTER TABLE public.support_cases ADD COLUMN inbox_state text NOT NULL DEFAULT 'open' CHECK(inbox_state IN('open','attention','taken_over','closed'));
CREATE OR REPLACE FUNCTION public.set_support_inbox(p_id uuid,p_state text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR p_state NOT IN('open','taken_over','closed') THEN RAISE EXCEPTION 'Invalid state';END IF;
 UPDATE support_cases SET inbox_state=p_state WHERE id=p_id AND user_id=auth.uid();RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.set_support_inbox(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_support_inbox(uuid,text) TO authenticated;
-- Serialise handoff changes with reservation/final-answer acceptance on the case row.
CREATE OR REPLACE FUNCTION public.support_reserve_knowledge(p_hash text,p_question text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;
BEGIN
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RAISE EXCEPTION 'AI paused: case taken over, closed or expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,0));
 IF(SELECT count(*) FROM knowledge_interactions WHERE case_id=c.id)>=20 OR (SELECT count(*) FROM knowledge_interactions WHERE user_id=c.user_id AND created_at>=date_trunc('day',now()))>=100 THEN RAISE EXCEPTION 'Demo question budget reached';END IF;
 INSERT INTO knowledge_interactions(user_id,case_id,question,supported,source_count) VALUES(c.user_id,c.id,p_question,false,0) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE OR REPLACE FUNCTION public.support_finish_knowledge(p_hash text,p_id uuid,p_supported boolean,p_count integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;
BEGIN
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR c.inbox_state IN('taken_over','closed') THEN RETURN false;END IF;
 UPDATE knowledge_interactions SET supported=p_supported,source_count=p_count WHERE id=p_id AND case_id=c.id;RETURN FOUND;
END;
$$;
-- The existing view base remains private; public view includes only case state.
CREATE OR REPLACE FUNCTION public.support_case_view(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT public.support_case_view_base(p_hash)||jsonb_build_object('controls',coalesce(s.controls,'{}'::jsonb),'inboxState',c.inbox_state)
 FROM support_cases c LEFT JOIN widget_settings s ON s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;
CREATE FUNCTION public.support_attention() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN UPDATE support_cases SET inbox_state='attention' WHERE id=NEW.case_id AND inbox_state='open';RETURN NEW;END;
$$;
CREATE TRIGGER support_attention AFTER INSERT ON public.support_requests FOR EACH ROW EXECUTE FUNCTION public.support_attention();
