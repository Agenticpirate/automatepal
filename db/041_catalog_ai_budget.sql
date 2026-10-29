-- Counter only; never save catalog/customer text or model prompts here.
CREATE TABLE catalog_ai_budget(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,utc_day date NOT NULL,attempts smallint NOT NULL CHECK(attempts BETWEEN 0 AND 10));
ALTER TABLE catalog_ai_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_catalog_ai_budget ON catalog_ai_budget FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON catalog_ai_budget TO authenticated;
CREATE FUNCTION reserve_catalog_ai() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();n integer;d date:=(now() AT TIME ZONE 'UTC')::date;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,97));
 INSERT INTO catalog_ai_budget(user_id,utc_day,attempts) VALUES(uid,d,0) ON CONFLICT(user_id) DO NOTHING;
 UPDATE catalog_ai_budget SET utc_day=d,attempts=0 WHERE user_id=uid AND utc_day<>d;
 UPDATE catalog_ai_budget SET attempts=attempts+1 WHERE user_id=uid AND attempts<10 RETURNING attempts INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'Daily catalog question budget reached';END IF;
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION reserve_catalog_ai() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION reserve_catalog_ai() TO authenticated;
