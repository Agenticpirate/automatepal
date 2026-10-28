-- Small text knowledge preview. Explicit publish opt-in; no crawler or vector claims.
CREATE TABLE public.knowledge_documents(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),title text NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
 content text NOT NULL CHECK(length(content) BETWEEN 20 AND 30000),
 published boolean NOT NULL DEFAULT false,
 search tsvector GENERATED ALWAYS AS(to_tsvector('english',content)) STORED
);
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_knowledge ON public.knowledge_documents FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,DELETE ON public.knowledge_documents TO authenticated;
CREATE INDEX knowledge_search ON public.knowledge_documents USING gin(search);
CREATE OR REPLACE FUNCTION public.support_knowledge_search(p_hash text,p_query text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'excerpt',x.excerpt)),'[]'::jsonb) FROM (
 SELECT d.id,d.title,left(d.content,5000) excerpt
 FROM public.knowledge_documents d JOIN public.support_cases c ON c.user_id=d.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND length(p_query) BETWEEN 3 AND 500
 AND d.search@@websearch_to_tsquery('english',p_query)
 ORDER BY ts_rank_cd(d.search,websearch_to_tsquery('english',p_query)) DESC LIMIT 3
 )x;
$$;
REVOKE ALL ON FUNCTION public.support_knowledge_search(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_knowledge_search(text,text) TO anon,authenticated;
