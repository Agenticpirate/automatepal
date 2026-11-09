-- Automatic webhook delivery (Phase 3). The owner-driven claim/finish (026/043) stay; these service-role
-- versions let the server deliver due events itself: right after a visitor request (app/api/support, by the
-- case's workspace) and in the hourly job (any workspace) for retries. Same rules: enabled webhook, at most 3
-- attempts, 1 then 5 minutes apart, stale 'sending' claims released after 30 seconds. Only workspaces whose
-- plan includes webhooks (db/057) are delivered.
CREATE FUNCTION public.service_webhook_claim(p_ws uuid,p_case_hash text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=p_ws;r jsonb;
BEGIN
 IF p_case_hash IS NOT NULL THEN SELECT user_id INTO ws FROM support_cases WHERE token_hash=p_case_hash;IF ws IS NULL THEN RETURN '[]'::jsonb;END IF;END IF;
 UPDATE demo_webhook_events SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,next_at=now()+interval '1 minute'
  WHERE status='sending' AND claimed_at<now()-interval '30 seconds' AND (ws IS NULL OR user_id=ws);
 WITH due AS (
   SELECT e.id FROM demo_webhook_events e JOIN demo_webhooks w ON w.id=e.webhook_id AND w.enabled
   WHERE e.status='pending' AND e.attempts<3 AND e.next_at<=now() AND (ws IS NULL OR e.user_id=ws)
     AND public.workspace_has_feature(e.user_id,'webhooks')
   ORDER BY e.next_at LIMIT least(greatest(coalesce(p_limit,10),1),25) FOR UPDATE OF e SKIP LOCKED),
  claimed AS (UPDATE demo_webhook_events e SET status='sending',attempts=e.attempts+1,claimed_at=now() FROM due WHERE e.id=due.id RETURNING e.*)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'url',w.url,'secret',w.secret,'payload',c.payload,'attempt',c.attempts)),'[]'::jsonb) INTO r
  FROM claimed c JOIN demo_webhooks w ON w.id=c.webhook_id;
 RETURN r;
END$$;
CREATE FUNCTION public.service_webhook_finish(p_id uuid,p_status integer,p_attempt integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE demo_webhook_events SET status=CASE WHEN p_status BETWEEN 200 AND 299 THEN 'delivered' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,last_status=p_status,
  delivered_at=CASE WHEN p_status BETWEEN 200 AND 299 THEN now() ELSE NULL END,next_at=now()+CASE WHEN attempts=1 THEN interval '1 minute' ELSE interval '5 minutes' END
  WHERE id=p_id AND status='sending' AND attempts=p_attempt;
 RETURN FOUND;
END$$;
REVOKE ALL ON FUNCTION public.service_webhook_claim(uuid,text,integer),public.service_webhook_finish(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_webhook_claim(uuid,text,integer),public.service_webhook_finish(uuid,integer,integer) TO service_role;
