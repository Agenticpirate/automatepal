-- Atomic source replacement. Old text/chunks remain active until all new embeddings are ready.
ALTER TABLE public.knowledge_documents ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.save_knowledge_source(p_id uuid,p_expected timestamptz,p_title text,p_content text,p_published boolean,p_chunks jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE uid uuid:=auth.uid();existing public.knowledge_documents;pages integer;cnt integer;item jsonb;pos integer:=0;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 IF length(p_title) NOT BETWEEN 3 AND 120 OR length(p_content) NOT BETWEEN 20 AND 30000 OR p_published IS NULL OR jsonb_typeof(p_chunks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid source';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 SELECT * INTO existing FROM public.knowledge_documents WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF existing.user_id<>uid OR p_expected IS NULL OR existing.updated_at<>p_expected THEN RAISE EXCEPTION 'Source changed or unavailable. Reload before editing';END IF;
 ELSIF p_expected IS NOT NULL THEN RAISE EXCEPTION 'Source changed or unavailable. Reload before editing';END IF;
 SELECT count(*),coalesce(sum(ceil(length(content)::numeric/2500)),0) INTO cnt,pages FROM public.knowledge_documents WHERE user_id=uid AND id<>p_id;
 IF cnt>=30 OR pages+ceil(length(p_content)::numeric/2500)>360 THEN RAISE EXCEPTION 'Preview quota reached: 30 sources or 360 page units';END IF;
 INSERT INTO public.knowledge_documents(id,user_id,title,content,published,updated_at) VALUES(p_id,uid,p_title,p_content,p_published,clock_timestamp()) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,published=excluded.published,updated_at=excluded.updated_at;
 DELETE FROM public.knowledge_chunks WHERE document_id=p_id AND user_id=uid;
 FOR item IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP
  IF jsonb_typeof(item->'embedding') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'embedding')<>768 OR length(item->>'content') NOT BETWEEN 1 AND 1200 THEN RAISE EXCEPTION 'Invalid chunks';END IF;
  INSERT INTO public.knowledge_chunks(id,document_id,user_id,position,content,embedding) VALUES(gen_random_uuid(),p_id,uid,pos,item->>'content',(item->'embedding')::text::extensions.vector(768));pos:=pos+1;
 END LOOP;
 RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_knowledge_source(uuid,timestamptz,text,text,boolean,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_knowledge_source(uuid,timestamptz,text,text,boolean,jsonb) TO authenticated;
