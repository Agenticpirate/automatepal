-- Metadata-only, tenant-scoped operational history. Not a compliance audit log.
CREATE TABLE public.owner_audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resource text NOT NULL,operation text NOT NULL CHECK(operation IN('INSERT','UPDATE','DELETE')),
 resource_id uuid NOT NULL
);
ALTER TABLE public.owner_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_audit_events ON public.owner_audit_events FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.owner_audit_events TO authenticated;
CREATE INDEX owner_audit_events_owner_time ON public.owner_audit_events(user_id,created_at DESC);
CREATE FUNCTION public.record_owner_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid;rid uuid;
BEGIN
 IF TG_OP='DELETE' THEN uid:=OLD.user_id;rid:=coalesce(to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'user_id')::uuid;ELSE uid:=NEW.user_id;rid:=coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'user_id')::uuid;END IF;
 -- Log successful owner writes only, not anonymous visitor queries. Never copy payloads.
 IF auth.uid()=uid THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,42));
  DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=uid ORDER BY created_at DESC,id DESC OFFSET 999);
  INSERT INTO owner_audit_events(user_id,resource,operation,resource_id) VALUES(uid,TG_TABLE_NAME,TG_OP,rid);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_owner_audit() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['knowledge_documents','custom_responses','widget_settings','support_cases','support_requests','readonly_tokens','demo_webhooks','action_proposals','proof_contracts'] LOOP
  EXECUTE format('CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit()',t);
 END LOOP;
END $$;
