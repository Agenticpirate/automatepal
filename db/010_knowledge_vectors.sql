CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE TABLE public.knowledge_chunks(
 id uuid PRIMARY KEY,document_id uuid NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,position integer NOT NULL CHECK(position>=0 AND position<30),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 1200),embedding extensions.vector(768) NOT NULL,
 model text NOT NULL DEFAULT 'gemini-embedding-2' CHECK(model='gemini-embedding-2'),UNIQUE(document_id,position)
);
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_chunks ON public.knowledge_chunks FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY insert_own_chunks ON public.knowledge_chunks FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.knowledge_documents d WHERE d.id=document_id AND d.user_id=auth.uid()));
GRANT SELECT,INSERT ON public.knowledge_chunks TO authenticated;
CREATE OR REPLACE FUNCTION public.support_knowledge_vectors(p_hash text,p_embedding extensions.vector(768)) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'documentId',x.document_id,'title',x.title,'excerpt',x.content,'score',x.score)),'[]'::jsonb) FROM(
 SELECT k.id,k.document_id,d.title,k.content,1-(k.embedding<=>p_embedding) score
 FROM public.knowledge_chunks k JOIN public.knowledge_documents d ON d.id=k.document_id AND d.user_id=k.user_id
 JOIN public.support_cases c ON c.user_id=d.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND k.model='gemini-embedding-2'
 AND 1-(k.embedding<=>p_embedding)>=0.72
 ORDER BY k.embedding<=>p_embedding LIMIT 4)x;
$$;
REVOKE ALL ON FUNCTION public.support_knowledge_vectors(text,extensions.vector) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_knowledge_vectors(text,extensions.vector) TO anon,authenticated;
