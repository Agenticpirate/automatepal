-- Phase 3: sources refresh API. Additive. A token with the new scope sources:refresh lets a workspace's own
-- systems (a deploy hook, a CMS publish event) ask for the website refresh now instead of waiting for the schedule.
-- The run is the scheduled one (lib/refresh.ts): changes land in the owner's review queue, nothing is published.
-- Limits: one run per workspace per 10 minutes and 24 per UTC day; plan needs API access.
ALTER TABLE public.readonly_tokens DROP CONSTRAINT readonly_tokens_scope_check;
ALTER TABLE public.readonly_tokens ADD CONSTRAINT readonly_tokens_scope_check CHECK(scope IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write','chat:write','sources:refresh'));

CREATE TABLE public.api_refresh_requests(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 last_at timestamptz NOT NULL,
 day date NOT NULL,
 day_count integer NOT NULL CHECK(day_count BETWEEN 1 AND 24));
ALTER TABLE public.api_refresh_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_refresh_requests FROM PUBLIC,anon,authenticated;

-- Service role: claim one API refresh run. NULL = token invalid, revoked, expired, wrong scope or plan without
-- API access (same answer for all). {retryAfter: seconds} = too soon or the day's 24 are used.
-- {workspace, sitemapUrl} = run it now.
CREATE FUNCTION public.api_refresh_claim(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t readonly_tokens;r api_refresh_requests;today date:=(now() AT TIME ZONE 'utc')::date;wait integer;
BEGIN
 SELECT * INTO t FROM readonly_tokens WHERE token_hash=p_token_hash AND scope='sources:refresh' AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND OR NOT public.workspace_has_feature(t.user_id,'api') THEN RETURN NULL;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t.user_id::text,64));
 SELECT * INTO r FROM api_refresh_requests WHERE user_id=t.user_id;
 IF FOUND THEN
  wait:=ceil(extract(epoch FROM r.last_at+interval '10 minutes'-clock_timestamp()));
  IF wait>0 THEN RETURN jsonb_build_object('retryAfter',wait);END IF;
  IF r.day=today AND r.day_count>=24 THEN RETURN jsonb_build_object('retryAfter',ceil(extract(epoch FROM (today+1)::timestamp-(now() AT TIME ZONE 'utc'))));END IF;
 END IF;
 INSERT INTO api_refresh_requests(user_id,last_at,day,day_count) VALUES(t.user_id,clock_timestamp(),today,1)
  ON CONFLICT(user_id) DO UPDATE SET last_at=EXCLUDED.last_at,day=EXCLUDED.day,
   day_count=CASE WHEN api_refresh_requests.day=EXCLUDED.day THEN api_refresh_requests.day_count+1 ELSE 1 END;
 RETURN jsonb_build_object('workspace',t.user_id,'sitemapUrl',(SELECT sitemap_url FROM refresh_settings WHERE user_id=t.user_id));
END$$;
REVOKE ALL ON FUNCTION public.api_refresh_claim(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.api_refresh_claim(text) TO service_role;

-- Token creation accepts sources:refresh (as 060, plus the scope; it needs API access like chat:write).
CREATE OR REPLACE FUNCTION public.create_readonly_token(p_label text, p_hash text, p_scope text, p_hours integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE rid uuid;
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF public.acting_workspace() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read','health:read','mcp:read','knowledge:write','bot:test','conversations:reply','settings:read','settings:write','chat:write','sources:refresh') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 IF NOT public.workspace_has_feature(public.acting_workspace(),CASE WHEN p_scope IN('support:read','analytics:read','health:read','chat:write','sources:refresh') THEN 'api' ELSE 'mcp' END) THEN RAISE EXCEPTION 'Upgrade required: % is not included in your plan',CASE WHEN p_scope IN('support:read','analytics:read','health:read','chat:write','sources:refresh') THEN 'API access' ELSE 'the MCP server' END;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(public.acting_workspace()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=public.acting_workspace() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(public.acting_workspace(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$function$;
