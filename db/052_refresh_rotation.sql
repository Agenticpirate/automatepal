-- 052: Scheduled refresh rotation and sitemap memory. Apply ONCE, after 051. Not idempotent.
--
-- Fixes two gaps in 050:
-- 1. Rotation. Each run re-checks at most 15 saved website pages. knowledge_refresh_checks records when each
--    saved page was last re-checked, and service_refresh_sources now lists the least recently checked pages
--    first, so every saved page is re-checked in turn instead of only the newest 15.
-- 2. Sitemap memory. refresh_seen_urls records sitemap URLs that were already read or proposed. The first
--    successful sitemap read is the baseline: its URLs are recorded and none is proposed as new. Later runs
--    propose only URLs not seen before and never a URL that already has a review item (pending, applied or
--    dismissed), so dismissed pages do not come back. Changing the sitemap URL starts a new baseline.
-- Both tables are service-only (no member access) and are removed by cascade: checks with their knowledge
-- source, seen URLs with refresh_settings, so delete_preview_data (051) clears them without a change.

CREATE TABLE public.knowledge_refresh_checks(
 document_id uuid PRIMARY KEY REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX knowledge_refresh_checks_ws ON public.knowledge_refresh_checks(user_id);
ALTER TABLE public.knowledge_refresh_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_refresh_checks FROM PUBLIC,anon,authenticated;

CREATE TABLE public.refresh_seen_urls(
 user_id uuid NOT NULL REFERENCES public.refresh_settings(user_id) ON DELETE CASCADE,
 url text NOT NULL CHECK(length(url) BETWEEN 9 AND 500 AND url ~ '^https?://'),
 first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,url)
);
CREATE INDEX refresh_seen_urls_age ON public.refresh_seen_urls(user_id,first_seen_at DESC);
ALTER TABLE public.refresh_seen_urls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refresh_seen_urls FROM PUBLIC,anon,authenticated;

-- The 050 body, plus: a changed sitemap URL clears the remembered URLs (the next read is a new baseline).
CREATE OR REPLACE FUNCTION public.set_refresh_settings(p_frequency text,p_sitemap_url text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=public.acting_workspace();u text:=nullif(btrim(coalesce(p_sitemap_url,'')),'');old text;had boolean:=false;
BEGIN
 IF uid IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_frequency IS NULL OR p_frequency NOT IN('off','monthly','weekly','daily') THEN RAISE EXCEPTION 'Invalid frequency';END IF;
 SELECT sitemap_url,true INTO old,had FROM refresh_settings WHERE user_id=uid;
 INSERT INTO refresh_settings(user_id,frequency,sitemap_url,next_due_at) VALUES(uid,p_frequency,u,CASE WHEN p_frequency='off' THEN NULL ELSE clock_timestamp() END)
  ON CONFLICT(user_id) DO UPDATE SET frequency=EXCLUDED.frequency,sitemap_url=EXCLUDED.sitemap_url,updated_at=clock_timestamp(),
   next_due_at=CASE WHEN EXCLUDED.frequency='off' THEN NULL
    WHEN refresh_settings.last_run_at IS NULL THEN clock_timestamp()
    ELSE refresh_settings.last_run_at+public.refresh_interval(EXCLUDED.frequency) END;
 IF coalesce(had,false) AND old IS DISTINCT FROM u THEN DELETE FROM refresh_seen_urls WHERE user_id=uid;END IF;
 RETURN true;
END$$;

-- Saved website sources of one workspace (30), least recently re-checked first, with checkedAt.
CREATE OR REPLACE FUNCTION public.service_refresh_sources(p_ws uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'content',content,'updatedAt',updated_at,'published',published,'checkedAt',checked_at) ORDER BY checked_at ASC NULLS FIRST,created_at DESC,id),'[]'::jsonb)
 FROM (SELECT d.id,d.title,d.content,d.updated_at,d.published,d.created_at,k.checked_at FROM knowledge_documents d
  LEFT JOIN knowledge_refresh_checks k ON k.document_id=d.id AND k.user_id=d.user_id
  WHERE d.user_id=p_ws AND d.source_kind='text' AND d.content ~ '^Source: https?://'
  ORDER BY k.checked_at ASC NULLS FIRST,d.created_at DESC,d.id LIMIT 30) d
$$;

-- Which of p_urls (a JSON array, first 500 used) are new: not remembered and without any review item.
-- baseline is true while nothing is remembered yet; the caller then proposes nothing and records the read.
CREATE FUNCTION public.service_refresh_unseen(p_ws uuid,p_urls jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'baseline',NOT EXISTS(SELECT 1 FROM refresh_seen_urls WHERE user_id=p_ws),
  'unseen',coalesce((SELECT jsonb_agg(u.url ORDER BY u.ord) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_urls)='array' THEN p_urls ELSE '[]'::jsonb END) WITH ORDINALITY u(url,ord)
   WHERE u.ord<=500
    AND NOT EXISTS(SELECT 1 FROM refresh_seen_urls s WHERE s.user_id=p_ws AND s.url=u.url)
    AND NOT EXISTS(SELECT 1 FROM knowledge_refresh_items i WHERE i.user_id=p_ws AND i.url=u.url)),'[]'::jsonb))
$$;

-- The 050 recorder, plus p_checked (document ids re-checked this run, first 100) and p_seen (sitemap URLs to
-- remember, first 500; at most 5000 kept per workspace, newest first). Callers with three arguments still work.
DROP FUNCTION public.service_refresh_record(uuid,jsonb,jsonb);
CREATE FUNCTION public.service_refresh_record(p_ws uuid,p_items jsonb,p_summary jsonb,p_checked jsonb DEFAULT '[]'::jsonb,p_seen jsonb DEFAULT '[]'::jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE it jsonb;n integer:=0;doc uuid;
BEGIN
 IF p_ws IS NULL OR jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' OR jsonb_typeof(coalesce(p_checked,'[]'::jsonb))<>'array' OR jsonb_typeof(coalesce(p_seen,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Invalid refresh run';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,50));
 FOR it IN SELECT jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LIMIT 100 LOOP
  EXIT WHEN (SELECT count(*) FROM knowledge_refresh_items WHERE user_id=p_ws AND status='pending')>=100
   AND NOT EXISTS(SELECT 1 FROM knowledge_refresh_items WHERE user_id=p_ws AND status='pending' AND url=it->>'url');
  doc:=NULL;
  IF it->>'documentId' IS NOT NULL THEN SELECT id INTO doc FROM knowledge_documents WHERE id=(it->>'documentId')::uuid AND user_id=p_ws;
   IF doc IS NULL THEN CONTINUE;END IF;
  END IF;
  INSERT INTO knowledge_refresh_items(user_id,document_id,url,kind,title,content)
   VALUES(p_ws,doc,it->>'url',it->>'kind',left(coalesce(nullif(btrim(it->>'title'),''),it->>'url'),120),CASE WHEN it->>'kind'='removed' THEN NULL ELSE left(it->>'content',30000) END)
   ON CONFLICT(user_id,url) WHERE status='pending' DO UPDATE SET document_id=EXCLUDED.document_id,kind=EXCLUDED.kind,title=EXCLUDED.title,content=EXCLUDED.content,detected_at=clock_timestamp();
  n:=n+1;
 END LOOP;
 DELETE FROM knowledge_refresh_items WHERE id IN(SELECT id FROM knowledge_refresh_items WHERE user_id=p_ws AND status<>'pending' ORDER BY detected_at DESC,id DESC OFFSET 200);
 INSERT INTO knowledge_refresh_checks(document_id,user_id,checked_at)
  SELECT d.id,p_ws,clock_timestamp() FROM knowledge_documents d
  WHERE d.user_id=p_ws AND d.id::text IN(SELECT x FROM jsonb_array_elements_text(coalesce(p_checked,'[]'::jsonb)) WITH ORDINALITY t(x,o) WHERE o<=100)
  ON CONFLICT(document_id) DO UPDATE SET checked_at=EXCLUDED.checked_at;
 IF EXISTS(SELECT 1 FROM refresh_settings WHERE user_id=p_ws) THEN
  INSERT INTO refresh_seen_urls(user_id,url)
   SELECT DISTINCT p_ws,x FROM jsonb_array_elements_text(coalesce(p_seen,'[]'::jsonb)) WITH ORDINALITY t(x,o)
   WHERE o<=500 AND length(x) BETWEEN 9 AND 500 AND x ~ '^https?://'
   ON CONFLICT DO NOTHING;
  DELETE FROM refresh_seen_urls WHERE user_id=p_ws AND url IN(SELECT url FROM refresh_seen_urls WHERE user_id=p_ws ORDER BY first_seen_at DESC,url OFFSET 5000);
 END IF;
 UPDATE refresh_settings SET last_run_at=clock_timestamp(),last_summary=p_summary,
  next_due_at=CASE WHEN frequency='off' THEN NULL ELSE clock_timestamp()+public.refresh_interval(frequency) END WHERE user_id=p_ws;
 RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.service_refresh_unseen(uuid,jsonb),public.service_refresh_record(uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_refresh_unseen(uuid,jsonb),public.service_refresh_record(uuid,jsonb,jsonb,jsonb,jsonb) TO service_role;
