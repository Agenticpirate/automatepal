-- Shared rate-limit counters, so a limit holds across server processes and Cloudflare isolates.
-- lib/rate-limit.ts keeps its in-process guard as the first check and then calls rate_limit_hit through
-- the service-role client. Keys arrive already hashed (sha256 hex): no user ids, tokens or IPs are stored.
-- UNLOGGED: counters are throwaway; losing them in a crash only resets the current minute.
CREATE UNLOGGED TABLE public.rate_limit_counters(
 key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
 window_start timestamptz NOT NULL,
 hits integer NOT NULL DEFAULT 0,
 PRIMARY KEY (key_hash, window_start)
);
CREATE INDEX rate_limit_counters_window ON public.rate_limit_counters(window_start);
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_counters FROM PUBLIC,anon,authenticated;

-- Counts one hit in the current fixed window and says whether it is within p_max.
-- Expired windows are pruned on roughly 1 call in 100.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w timestamptz; n integer;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid key'; END IF;
 IF p_max IS NULL OR p_max < 1 OR p_max > 100000 THEN RAISE EXCEPTION 'invalid max'; END IF;
 IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 3600 THEN RAISE EXCEPTION 'invalid window'; END IF;
 w := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds);
 INSERT INTO public.rate_limit_counters AS r(key_hash, window_start, hits) VALUES (p_key, w, 1)
  ON CONFLICT (key_hash, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING hits INTO n;
 IF random() < 0.01 THEN
  DELETE FROM public.rate_limit_counters WHERE window_start < clock_timestamp() - interval '2 hours';
 END IF;
 RETURN n <= p_max;
END $$;
REVOKE ALL ON FUNCTION public.rate_limit_hit(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text,integer,integer) TO service_role;
