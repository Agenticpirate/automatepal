-- Bounded operational history, no raw source text or provider errors.
CREATE TABLE public.knowledge_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_id uuid NOT NULL,status text NOT NULL DEFAULT 'processing' CHECK(status IN('processing','success','failed','limit_reached')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz
);
ALTER TABLE public.knowledge_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_attempts ON public.knowledge_attempts FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.knowledge_attempts TO authenticated;
CREATE INDEX knowledge_attempts_owner ON public.knowledge_attempts(user_id,started_at DESC);
CREATE OR REPLACE FUNCTION public.start_knowledge_attempt(p_source uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();rid uuid;
BEGIN
 IF uid IS NULL OR p_source IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 IF EXISTS(SELECT 1 FROM knowledge_documents WHERE id=p_source AND user_id<>uid) THEN RAISE EXCEPTION 'Source unavailable';END IF;
 IF(SELECT count(*) FROM knowledge_attempts WHERE user_id=uid AND status='processing' AND started_at>now()-interval '5 minutes')>=3 THEN RAISE EXCEPTION 'Too many active imports';END IF;
 DELETE FROM knowledge_attempts WHERE id IN(SELECT id FROM knowledge_attempts WHERE user_id=uid ORDER BY started_at DESC OFFSET 99);
 INSERT INTO knowledge_attempts(user_id,source_id) VALUES(uid,p_source) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE OR REPLACE FUNCTION public.fail_knowledge_attempt(p_id uuid,p_status text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_status NOT IN('failed','limit_reached') THEN RAISE EXCEPTION 'Invalid attempt status';END IF;
 UPDATE knowledge_attempts SET status=p_status,finished_at=clock_timestamp() WHERE id=p_id AND user_id=auth.uid() AND status='processing';RETURN FOUND;
END;
$$;
CREATE OR REPLACE FUNCTION public.save_knowledge_attempt(p_attempt uuid,p_id uuid,p_expected timestamptz,p_title text,p_content text,p_published boolean,p_chunks jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r uuid;
BEGIN
 PERFORM 1 FROM knowledge_attempts WHERE id=p_attempt AND user_id=auth.uid() AND source_id=p_id AND status='processing' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import attempt unavailable';END IF;
 r:=public.save_knowledge_source(p_id,p_expected,p_title,p_content,p_published,p_chunks);
 UPDATE knowledge_attempts SET status='success',finished_at=clock_timestamp() WHERE id=p_attempt;RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.start_knowledge_attempt(uuid),public.fail_knowledge_attempt(uuid,text),public.save_knowledge_attempt(uuid,uuid,timestamptz,text,text,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_knowledge_attempt(uuid),public.fail_knowledge_attempt(uuid,text),public.save_knowledge_attempt(uuid,uuid,timestamptz,text,text,boolean,jsonb) TO authenticated;
