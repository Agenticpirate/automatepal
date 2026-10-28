-- Opt-in fictional metadata delivery only. Signing secrets are never SELECT-able
-- by ordinary table readers; claim RPC returns an owner's key only to its caller.
CREATE TABLE public.demo_webhooks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,url text NOT NULL CHECK(length(url)<=500),secret text NOT NULL,enabled boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.demo_webhook_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,webhook_id uuid NOT NULL REFERENCES demo_webhooks(id) ON DELETE CASCADE,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','delivered','failed')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),next_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,delivered_at timestamptz,last_status integer);
ALTER TABLE public.demo_webhooks ENABLE ROW LEVEL SECURITY;ALTER TABLE public.demo_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_webhooks ON public.demo_webhooks FOR SELECT TO authenticated USING(user_id=auth.uid());CREATE POLICY own_webhook_events ON public.demo_webhook_events FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT(id,user_id,url,enabled,created_at) ON public.demo_webhooks TO authenticated;
GRANT SELECT ON public.demo_webhook_events TO authenticated;
CREATE FUNCTION public.configure_demo_webhook(p_url text,p_enabled boolean,p_consent boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE r demo_webhooks;k text;
BEGIN
 IF auth.uid() IS NULL OR p_enabled IS NULL OR p_enabled AND p_consent IS DISTINCT FROM true OR p_url IS NULL OR length(p_url)>500 OR p_url!~'^https://[A-Za-z0-9.-]+(/[^?#]*)?$' THEN RAISE EXCEPTION 'Invalid URL or consent';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM demo_webhooks WHERE user_id=auth.uid() FOR UPDATE;
 IF FOUND THEN
  IF r.url<>p_url THEN DELETE FROM demo_webhook_events WHERE webhook_id=r.id; k:=encode(gen_random_bytes(32),'hex');END IF;
  UPDATE demo_webhooks SET url=p_url,enabled=p_enabled,secret=coalesce(k,secret) WHERE id=r.id;
 ELSE k:=encode(gen_random_bytes(32),'hex');INSERT INTO demo_webhooks(user_id,url,enabled,secret) VALUES(auth.uid(),p_url,p_enabled,k) RETURNING * INTO r;END IF;
 IF NOT p_enabled THEN UPDATE demo_webhook_events SET status='failed' WHERE webhook_id=r.id AND status IN('pending','sending');END IF;
 RETURN jsonb_build_object('id',r.id,'signingKey',k);
END;
$$;
CREATE FUNCTION public.queue_demo_webhook() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE w demo_webhooks;eid uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO w FROM demo_webhooks WHERE user_id=NEW.user_id AND enabled=true;
 IF FOUND THEN
  -- 100 queued events/workspace bounds retained records.
  DELETE FROM demo_webhook_events WHERE id IN(SELECT id FROM demo_webhook_events WHERE user_id=NEW.user_id ORDER BY next_at DESC OFFSET 99);
  INSERT INTO demo_webhook_events(id,user_id,webhook_id,payload) VALUES(eid,NEW.user_id,w.id,jsonb_build_object('id',eid,'type','demo.support_request','createdAt',NEW.created_at,'fictional',true,'data',jsonb_build_object('requestId',NEW.id,'caseId',NEW.case_id,'kind',NEW.kind,'status',NEW.status)));
 END IF;RETURN NEW;
END;
$$;
CREATE TRIGGER queue_demo_webhook AFTER INSERT ON public.support_requests FOR EACH ROW EXECUTE FUNCTION public.queue_demo_webhook();
CREATE FUNCTION public.claim_demo_webhook() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE e demo_webhook_events;w demo_webhooks;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO w FROM demo_webhooks WHERE user_id=auth.uid() AND enabled=true;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE demo_webhook_events SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,next_at=now()+interval '1 minute' WHERE user_id=auth.uid() AND status='sending' AND claimed_at<now()-interval '30 seconds';
 SELECT * INTO e FROM demo_webhook_events WHERE user_id=auth.uid() AND webhook_id=w.id AND status='pending' AND attempts<3 AND next_at<=now() ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE demo_webhook_events SET status='sending',attempts=attempts+1,claimed_at=now() WHERE id=e.id;
 RETURN jsonb_build_object('id',e.id,'url',w.url,'secret',w.secret,'payload',e.payload,'attempt',e.attempts+1);
END;
$$;
CREATE FUNCTION public.finish_demo_webhook(p_id uuid,p_status integer,p_attempt integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 UPDATE demo_webhook_events SET status=CASE WHEN p_status BETWEEN 200 AND 299 THEN 'delivered' WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,last_status=p_status,delivered_at=CASE WHEN p_status BETWEEN 200 AND 299 THEN now() ELSE NULL END,next_at=now()+CASE WHEN attempts=1 THEN interval '1 minute' ELSE interval '5 minutes' END WHERE id=p_id AND user_id=auth.uid() AND status='sending' AND attempts=p_attempt;RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_demo_webhook(text,boolean,boolean),public.claim_demo_webhook(),public.finish_demo_webhook(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_demo_webhook(text,boolean,boolean),public.claim_demo_webhook(),public.finish_demo_webhook(uuid,integer,integer) TO authenticated;
