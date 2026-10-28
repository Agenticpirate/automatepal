-- Additive rollout: old saves produce ordinary text. Revoke legacy save wrapper only
-- after the application uses save_guidance_attempt (see 022).
ALTER TABLE public.knowledge_documents
 ADD COLUMN source_kind text NOT NULL DEFAULT 'text' CHECK(source_kind IN('text','owner_guidance')),
 ADD COLUMN applicability text NOT NULL DEFAULT '' CHECK(length(applicability)<=500),
 ADD COLUMN effective_from date,
 ADD COLUMN effective_until date,
 ADD CONSTRAINT guidance_dates CHECK(source_kind='text' OR
 (length(trim(applicability))>=10 AND effective_from IS NOT NULL AND effective_until IS NOT NULL AND effective_until>=effective_from));
CREATE OR REPLACE FUNCTION public.save_guidance_attempt(p_attempt uuid,p_id uuid,p_expected timestamptz,p_title text,p_content text,p_published boolean,p_chunks jsonb,p_metadata jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r uuid;k text:=p_metadata->>'sourceKind';a text:=coalesce(p_metadata->>'applicability','');f date;u date;
BEGIN
 IF auth.uid() IS NULL OR k IS NULL OR k NOT IN('text','owner_guidance') THEN RAISE EXCEPTION 'Invalid source type';END IF;
 IF k='owner_guidance' THEN
  f:=(p_metadata->>'effectiveFrom')::date;u:=(p_metadata->>'effectiveUntil')::date;
  IF length(trim(a)) NOT BETWEEN 10 AND 500 OR f IS NULL OR u IS NULL OR u<f THEN RAISE EXCEPTION 'Guidance needs scope and valid dates';END IF;
 ELSE a:='';END IF;
 r:=public.save_knowledge_attempt(p_attempt,p_id,p_expected,p_title,p_content,p_published,p_chunks);
 UPDATE public.knowledge_documents SET source_kind=k,applicability=a,effective_from=f,effective_until=u WHERE id=r AND user_id=auth.uid();
 RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.save_guidance_attempt(uuid,uuid,timestamptz,text,text,boolean,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_guidance_attempt(uuid,uuid,timestamptz,text,text,boolean,jsonb,jsonb) TO authenticated;
-- Retrieve guidance separately so a website cannot crowd it out. Both groups
-- retain the same conservative threshold. Stale notes stay candidates for a
-- fail-closed applicability/date check, never silently become current policy.
CREATE OR REPLACE FUNCTION public.support_knowledge_vectors(p_hash text,p_embedding extensions.vector(768)) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'documentId',x.document_id,'title',x.title,'excerpt',x.content,'score',x.score,'sourceKind',x.source_kind,'applicability',x.applicability,'effectiveFrom',x.effective_from,'effectiveUntil',x.effective_until) ORDER BY x.source_kind DESC,x.score DESC),'[]'::jsonb)
 FROM (SELECT * FROM (
 SELECT k.id,k.document_id,d.title,k.content,1-(k.embedding<=>p_embedding) score,d.source_kind,d.applicability,d.effective_from,d.effective_until,
 row_number() OVER(PARTITION BY d.source_kind ORDER BY k.embedding<=>p_embedding) rn
 FROM public.knowledge_chunks k JOIN public.knowledge_documents d ON d.id=k.document_id AND d.user_id=k.user_id
 JOIN public.support_cases c ON c.user_id=d.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now() AND d.published=true AND k.model='gemini-embedding-2' AND 1-(k.embedding<=>p_embedding)>=0.72
 ) ranked WHERE rn<=4) x;
$$;
