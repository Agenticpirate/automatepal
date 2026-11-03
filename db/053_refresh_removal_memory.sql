-- 053: Scheduled refresh, dismissed removals stay dismissed. Apply ONCE, after 052. Not idempotent.
--
-- In 052 a 'removed' review item the owner dismissed came back as pending on the next run, because the
-- recorder only conflicts on pending rows. Now:
-- * knowledge_refresh_checks.live_at records when a saved page was last fetched successfully (p_live).
-- * A 'removed' item is skipped when the owner dismissed a removal of the same saved page and the page has
--   not been seen live since that dismissal. If the page comes back and later disappears again, the new
--   removal is proposed.
-- No new table and no member access; delete_preview_data (051) is unchanged (checks cascade with sources).

ALTER TABLE public.knowledge_refresh_checks ADD COLUMN live_at timestamptz;

-- The 052 recorder, plus p_live (document ids fetched successfully this run, first 100) and the skip above.
-- Callers with three or five arguments still work.
DROP FUNCTION public.service_refresh_record(uuid,jsonb,jsonb,jsonb,jsonb);
CREATE FUNCTION public.service_refresh_record(p_ws uuid,p_items jsonb,p_summary jsonb,p_checked jsonb DEFAULT '[]'::jsonb,p_seen jsonb DEFAULT '[]'::jsonb,p_live jsonb DEFAULT '[]'::jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE it jsonb;n integer:=0;doc uuid;
BEGIN
 IF p_ws IS NULL OR jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' OR jsonb_typeof(coalesce(p_checked,'[]'::jsonb))<>'array' OR jsonb_typeof(coalesce(p_seen,'[]'::jsonb))<>'array' OR jsonb_typeof(coalesce(p_live,'[]'::jsonb))<>'array' THEN RAISE EXCEPTION 'Invalid refresh run';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_ws::text,50));
 FOR it IN SELECT jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LIMIT 100 LOOP
  EXIT WHEN (SELECT count(*) FROM knowledge_refresh_items WHERE user_id=p_ws AND status='pending')>=100
   AND NOT EXISTS(SELECT 1 FROM knowledge_refresh_items WHERE user_id=p_ws AND status='pending' AND url=it->>'url');
  doc:=NULL;
  IF it->>'documentId' IS NOT NULL THEN SELECT id INTO doc FROM knowledge_documents WHERE id=(it->>'documentId')::uuid AND user_id=p_ws;
   IF doc IS NULL THEN CONTINUE;END IF;
  END IF;
  IF it->>'kind'='removed' AND EXISTS(SELECT 1 FROM knowledge_refresh_items i
    LEFT JOIN knowledge_refresh_checks k ON k.document_id=i.document_id AND k.user_id=p_ws
    WHERE i.user_id=p_ws AND i.document_id=doc AND i.kind='removed' AND i.status='dismissed'
     AND (k.live_at IS NULL OR k.live_at<i.resolved_at)) THEN CONTINUE;END IF;
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
 INSERT INTO knowledge_refresh_checks(document_id,user_id,checked_at,live_at)
  SELECT d.id,p_ws,clock_timestamp(),clock_timestamp() FROM knowledge_documents d
  WHERE d.user_id=p_ws AND d.id::text IN(SELECT x FROM jsonb_array_elements_text(coalesce(p_live,'[]'::jsonb)) WITH ORDINALITY t(x,o) WHERE o<=100)
  ON CONFLICT(document_id) DO UPDATE SET live_at=EXCLUDED.live_at;
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
REVOKE ALL ON FUNCTION public.service_refresh_record(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_refresh_record(uuid,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;
