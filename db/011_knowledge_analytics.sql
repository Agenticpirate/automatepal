CREATE TABLE public.knowledge_interactions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),
 question text NOT NULL CHECK(length(question) BETWEEN 3 AND 500),supported boolean NOT NULL,source_count integer NOT NULL CHECK(source_count BETWEEN 0 AND 4),
 feedback smallint CHECK(feedback IN(-1,1))
);
ALTER TABLE public.knowledge_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_knowledge_interactions ON public.knowledge_interactions FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.knowledge_interactions TO authenticated;
CREATE OR REPLACE FUNCTION public.support_log_knowledge(p_hash text,p_question text,p_supported boolean,p_count integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;
BEGIN
 SELECT * INTO c FROM public.support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Demo expired';END IF;
 IF(SELECT count(*) FROM public.knowledge_interactions WHERE case_id=c.id)>=20 THEN RAISE EXCEPTION 'Demo question limit reached';END IF;
 INSERT INTO public.knowledge_interactions(user_id,case_id,question,supported,source_count) VALUES(c.user_id,c.id,p_question,p_supported,p_count) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE OR REPLACE FUNCTION public.support_rate_knowledge(p_hash text,p_id uuid,p_feedback smallint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.knowledge_interactions i SET feedback=p_feedback FROM public.support_cases c
 WHERE i.id=p_id AND i.case_id=c.id AND c.token_hash=p_hash AND c.expires_at>now() AND p_feedback IN(-1,1);RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.support_log_knowledge(text,text,boolean,integer),public.support_rate_knowledge(text,uuid,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_log_knowledge(text,text,boolean,integer),public.support_rate_knowledge(text,uuid,smallint) TO anon,authenticated;
