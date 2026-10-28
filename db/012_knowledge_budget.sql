-- Reserve a bounded request before any model call, persistent across process restarts.
CREATE OR REPLACE FUNCTION public.support_reserve_knowledge(p_hash text,p_question text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;
BEGIN
 SELECT * INTO c FROM public.support_cases WHERE token_hash=p_hash AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired demo';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,0));
 IF(SELECT count(*) FROM public.knowledge_interactions WHERE case_id=c.id)>=20 OR
 (SELECT count(*) FROM public.knowledge_interactions WHERE user_id=c.user_id AND created_at>=date_trunc('day',now()))>=100 THEN
 RAISE EXCEPTION 'Demo question budget reached';END IF;
 INSERT INTO public.knowledge_interactions(user_id,case_id,question,supported,source_count) VALUES(c.user_id,c.id,p_question,false,0) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE OR REPLACE FUNCTION public.support_finish_knowledge(p_hash text,p_id uuid,p_supported boolean,p_count integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.knowledge_interactions i SET supported=p_supported,source_count=p_count FROM public.support_cases c
 WHERE i.id=p_id AND i.case_id=c.id AND c.token_hash=p_hash AND c.expires_at>now();RETURN FOUND;
END;
$$;
-- Revoke legacy support_log_knowledge only after new app deployment acceptance.
REVOKE ALL ON FUNCTION public.support_reserve_knowledge(text,text),public.support_finish_knowledge(text,uuid,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_reserve_knowledge(text,text),public.support_finish_knowledge(text,uuid,boolean,integer) TO anon,authenticated;
