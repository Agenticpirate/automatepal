-- Disabled notification preferences. No credentials, destinations or transport worker.
CREATE TABLE public.owner_alert_preferences(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 minimum_priority text NOT NULL DEFAULT 'high' CHECK(minimum_priority IN('normal','high','urgent')),
 reasons jsonb NOT NULL DEFAULT '["refund","handoff","negative_feedback","unanswered"]'::jsonb CHECK(jsonb_typeof(reasons)='array' AND jsonb_array_length(reasons)<=4 AND reasons <@ '["refund","handoff","negative_feedback","unanswered"]'::jsonb),
 channel text NOT NULL DEFAULT 'telegram' CHECK(channel IN('telegram','email')),
 quiet_start integer NOT NULL DEFAULT 22 CHECK(quiet_start BETWEEN 0 AND 23),
 quiet_end integer NOT NULL DEFAULT 7 CHECK(quiet_end BETWEEN 0 AND 23),
 timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK(timezone IN('Asia/Kolkata','UTC')),
 digest boolean NOT NULL DEFAULT true,
 enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_alert_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_alert_preferences ON public.owner_alert_preferences FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.owner_alert_preferences TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.owner_alert_preferences FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();
CREATE TABLE public.owner_alert_checks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 eligible integer NOT NULL CHECK(eligible BETWEEN 0 AND 200),
 state text NOT NULL CHECK(state IN('dry_run','quiet_hours','digest_only')),
 sent boolean NOT NULL DEFAULT false CHECK(sent=false)
);
ALTER TABLE public.owner_alert_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_alert_checks ON public.owner_alert_checks FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.owner_alert_checks TO authenticated;
CREATE FUNCTION public.record_owner_alert_check(p_eligible integer,p_state text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();rid uuid;
BEGIN
 IF uid IS NULL OR p_eligible NOT BETWEEN 0 AND 200 OR p_state NOT IN('dry_run','quiet_hours','digest_only') THEN RAISE EXCEPTION 'Invalid check';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,85));
 IF EXISTS(SELECT 1 FROM owner_alert_checks WHERE user_id=uid AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Check already recorded this minute';END IF;
 DELETE FROM owner_alert_checks WHERE id IN(SELECT id FROM owner_alert_checks WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 99);
 INSERT INTO owner_alert_checks(user_id,eligible,state) VALUES(uid,p_eligible,p_state) RETURNING id INTO rid;RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.record_owner_alert_check(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_owner_alert_check(integer,text) TO authenticated;
CREATE TRIGGER owner_audit AFTER INSERT ON public.owner_alert_checks FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();
