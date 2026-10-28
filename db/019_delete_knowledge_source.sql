-- Serialize delete with source replacement. In-flight saves become unavailable.
CREATE OR REPLACE FUNCTION public.save_knowledge_attempt(p_attempt uuid,p_id uuid,p_expected timestamptz,p_title text,p_content text,p_published boolean,p_chunks jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 PERFORM 1 FROM knowledge_attempts WHERE id=p_attempt AND user_id=auth.uid() AND source_id=p_id AND status='processing' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import attempt unavailable';END IF;
 r:=public.save_knowledge_source(p_id,p_expected,p_title,p_content,p_published,p_chunks);
 UPDATE knowledge_attempts SET status='success',finished_at=clock_timestamp() WHERE id=p_attempt;RETURN r;
END;
$$;
CREATE OR REPLACE FUNCTION public.delete_knowledge_source(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 IF NOT EXISTS(SELECT 1 FROM knowledge_documents WHERE id=p_id AND user_id=uid) THEN RETURN false;END IF;
 DELETE FROM knowledge_attempts WHERE source_id=p_id AND user_id=uid;
 DELETE FROM knowledge_documents WHERE id=p_id AND user_id=uid;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_knowledge_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_knowledge_source(uuid) TO authenticated;
