CREATE TABLE operational_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_id uuid NOT NULL,code text NOT NULL CHECK(code IN('TICKET_READ_FAILED','TICKET_WRITE_FAILED','OWNER_SNAPSHOT_FAILED','ALERT_RULE_FAILED','SAFE_RETRY_STARTED','SAFE_RETRY_RECOVERED','SAFE_RETRY_EXHAUSTED')),severity text NOT NULL CHECK(severity IN('info','warning','error')),component text NOT NULL CHECK(component IN('tickets','owner','alerts','health')),release text NOT NULL CHECK(release~'^[a-zA-Z0-9_-]{1,40}$'),attempt smallint NOT NULL DEFAULT 1 CHECK(attempt BETWEEN 1 AND 3));
CREATE INDEX operational_events_owner_time ON operational_events(user_id,created_at DESC);
CREATE UNIQUE INDEX operational_events_request_code ON operational_events(user_id,request_id,code,attempt);
ALTER TABLE operational_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_operational_events ON operational_events FOR SELECT TO authenticated USING(user_id=auth.uid() AND created_at>=now()-interval '7 days');
GRANT SELECT ON operational_events TO authenticated;
CREATE FUNCTION record_operational_event(p_request uuid,p_code text,p_severity text,p_component text,p_release text,p_attempt smallint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,91));
 IF EXISTS(SELECT 1 FROM operational_events WHERE user_id=uid AND request_id=p_request AND code=p_code AND attempt=p_attempt) THEN RETURN true;END IF;
 DELETE FROM operational_events WHERE user_id=uid AND created_at<now()-interval '7 days';
 DELETE FROM operational_events WHERE id IN(SELECT id FROM operational_events WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 499);
 INSERT INTO operational_events(user_id,request_id,code,severity,component,release,attempt) VALUES(uid,p_request,p_code,p_severity,p_component,p_release,p_attempt);RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION record_operational_event(uuid,text,text,text,text,smallint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION record_operational_event(uuid,text,text,text,text,smallint) TO authenticated;
ALTER TABLE readonly_tokens DROP CONSTRAINT readonly_tokens_scope_check;
ALTER TABLE readonly_tokens ADD CONSTRAINT readonly_tokens_scope_check CHECK(scope IN('support:read','analytics:read','health:read'));
CREATE OR REPLACE FUNCTION public.create_readonly_token(p_label text,p_hash text,p_scope text,p_hours integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
 IF auth.uid() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read','health:read') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=auth.uid() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(auth.uid(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE FUNCTION operational_summary(p_hash text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid;r jsonb;
BEGIN
 IF p_hash IS NULL THEN uid:=auth.uid();ELSE SELECT user_id INTO uid FROM readonly_tokens WHERE token_hash=p_hash AND scope='health:read' AND revoked_at IS NULL AND expires_at>now();END IF;
 IF uid IS NULL THEN RETURN NULL;END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM(SELECT code,severity,component,count(*) AS count,max(created_at) AS latest FROM operational_events WHERE user_id=uid AND created_at>=now()-interval '24 hours' GROUP BY code,severity,component)x;
 RETURN jsonb_build_object('asOf',now(),'windowHours',24,'groups',r,'coverage','Instrumented ticket/owner/alert paths only; latest 500 retained rows. Not all exceptions are captured. Logging is best effort and may fail with the database. No events does not prove health.','dependencyProbe','database query succeeded; model/provider not probed','automatedRecovery','ticket-list transient DB connection/capacity failure: one read retry after 250ms; no automatic writes or deploy rollback');
END;
$$;
REVOKE ALL ON FUNCTION operational_summary(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION operational_summary(text) TO anon,authenticated;
