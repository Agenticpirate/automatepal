-- Phase 6 (own-site trial): retrieval was dropping the right passage. Similarity scores of this embedding model sit
-- in a narrow band: in the trial, answerable questions scored 0.70 to 0.72 against the passage that answers them and
-- unrelated questions 0.61 to 0.71, so the 0.72 cut-off refused most answerable questions without discriminating.
-- Text sources now pass with a score of 0.62 or more, up to 6 passages; the answer model, the exact-quote check and
-- the grounding check decide whether they support an answer. Owner guidance keeps 0.72 and 4. Additive: replaces
-- the function from db/062 with the same signature and output.
CREATE OR REPLACE FUNCTION public.support_knowledge_vectors(p_hash text, p_embedding vector)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'documentId',x.document_id,'title',x.title,'excerpt',x.content,'score',x.score,'sourceKind',x.source_kind,'applicability',x.applicability,'effectiveFrom',x.effective_from,'effectiveUntil',x.effective_until) ORDER BY x.source_kind DESC,x.score DESC),'[]'::jsonb)
 FROM (SELECT * FROM (
 SELECT k.id,k.document_id,d.title,k.content,1-(k.embedding<=>p_embedding) score,d.source_kind,d.applicability,d.effective_from,d.effective_until,
 row_number() OVER(PARTITION BY d.source_kind ORDER BY k.embedding<=>p_embedding) rn
 FROM public.knowledge_chunks k JOIN public.knowledge_documents d ON d.id=k.document_id AND d.user_id=k.user_id
 JOIN public.support_cases c ON c.user_id=d.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND (d.bot_ids IS NULL OR coalesce(c.bot_id,c.user_id)=ANY(d.bot_ids)) AND k.model='gemini-embedding-2'
  AND 1-(k.embedding<=>p_embedding)>=CASE WHEN d.source_kind='owner_guidance' THEN 0.72 ELSE 0.62 END
 ) ranked WHERE rn<=CASE WHEN source_kind='owner_guidance' THEN 4 ELSE 6 END) x;
$function$;

-- Keyword matching beside similarity. A question that hinges on one word ("WordPress", "contact", "Shopify") did
-- not pull the passage containing it when broader passages scored higher. This three-argument form also takes the
-- question text and adds up to 2 text passages that share the most question words (English stemming, stop words
-- dropped) and still score 0.55 or more, when they are not already among the 6. Same output shape.
CREATE FUNCTION public.support_knowledge_vectors(p_hash text, p_embedding vector, p_question text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
 WITH base AS (
  SELECT k.id,k.document_id,d.title,k.content,1-(k.embedding<=>p_embedding) score,d.source_kind,d.applicability,d.effective_from,d.effective_until
  FROM public.knowledge_chunks k JOIN public.knowledge_documents d ON d.id=k.document_id AND d.user_id=k.user_id
  JOIN public.support_cases c ON c.user_id=d.user_id
  WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND (d.bot_ids IS NULL OR coalesce(c.bot_id,c.user_id)=ANY(d.bot_ids)) AND k.model='gemini-embedding-2'),
 ranked AS (SELECT *,row_number() OVER(PARTITION BY source_kind ORDER BY score DESC) rn FROM base
  WHERE score>=CASE WHEN source_kind='owner_guidance' THEN 0.72 ELSE 0.62 END),
 picked AS (SELECT id,document_id,title,content,score,source_kind,applicability,effective_from,effective_until FROM ranked
  WHERE rn<=CASE WHEN source_kind='owner_guidance' THEN 4 ELSE 6 END),
 words AS (SELECT tsvector_to_array(to_tsvector('english',left(coalesce(p_question,''),500))) t),
 q AS (SELECT CASE WHEN cardinality(t)>0 THEN to_tsquery('simple',(SELECT string_agg(quote_literal(x),' | ') FROM unnest(t) x)) END tsq FROM words),
 lex AS (SELECT b.id,b.document_id,b.title,b.content,b.score,b.source_kind,b.applicability,b.effective_from,b.effective_until
  FROM base b CROSS JOIN q
  WHERE q.tsq IS NOT NULL AND b.source_kind<>'owner_guidance' AND b.score>=0.55 AND b.id NOT IN(SELECT id FROM picked)
   AND to_tsvector('english',b.content)@@q.tsq
  ORDER BY ts_rank(to_tsvector('english',b.content),q.tsq,1) DESC,b.score DESC LIMIT 2)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'documentId',x.document_id,'title',x.title,'excerpt',x.content,'score',x.score,'sourceKind',x.source_kind,'applicability',x.applicability,'effectiveFrom',x.effective_from,'effectiveUntil',x.effective_until) ORDER BY x.source_kind DESC,x.score DESC),'[]'::jsonb)
 FROM (SELECT * FROM picked UNION ALL SELECT * FROM lex) x;
$function$;
REVOKE ALL ON FUNCTION public.support_knowledge_vectors(text,vector,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_knowledge_vectors(text,vector,text) TO anon,authenticated;
