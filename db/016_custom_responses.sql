-- Exact normalized-question matching only. No fuzzy override or model-generated policy.
CREATE OR REPLACE FUNCTION public.normalize_support_question(q text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT lower(regexp_replace(btrim(q),'[[:space:]]+',' ','g')) $$;
CREATE TABLE public.custom_responses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 question text NOT NULL CHECK(length(question) BETWEEN 3 AND 300),answer text NOT NULL CHECK(length(answer) BETWEEN 10 AND 5000),
 normalized_question text GENERATED ALWAYS AS(public.normalize_support_question(question)) STORED,
 published boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(user_id,normalized_question)
);
ALTER TABLE public.custom_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_custom_responses ON public.custom_responses FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY delete_own_custom_responses ON public.custom_responses FOR DELETE TO authenticated USING(user_id=auth.uid());
GRANT SELECT,DELETE ON public.custom_responses TO authenticated;
CREATE OR REPLACE FUNCTION public.save_custom_response(p_id uuid,p_expected timestamptz,p_question text,p_answer text,p_published boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();r public.custom_responses;
BEGIN
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
$$;
CREATE OR REPLACE FUNCTION public.support_custom_response(p_hash text,p_question text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',r.id,'title',r.question,'answer',r.answer) FROM public.custom_responses r JOIN public.support_cases c ON c.user_id=r.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND r.published=true AND length(p_question) BETWEEN 3 AND 500 AND r.normalized_question=public.normalize_support_question(p_question) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.save_custom_response(uuid,timestamptz,text,text,boolean),public.support_custom_response(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_custom_response(uuid,timestamptz,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_custom_response(text,text) TO anon,authenticated;
