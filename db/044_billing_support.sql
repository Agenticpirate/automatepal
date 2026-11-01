-- 044: Billing support through payment providers. Read-only lookups, metadata-only audit.
-- Apply ONCE, after 043, to an isolated project first. Not idempotent.
--
-- Model: an owner connects a provider (test or live) with a read-only key. The credential is
-- encrypted by the server (AES-256-GCM) before it reaches the database; the ciphertext column is
-- never granted to `authenticated`, and the RPCs that return it require a server-only proof whose
-- sha256 is stored per connection. Visitors verify an order/invoice reference plus the payment email
-- (checked server-side, never stored); the resulting scope is sealed by the server before storage.
-- No RPC here moves money or calls a provider. Refund requests open the existing review ticket.

CREATE TABLE public.billing_connections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN('paypal','stripe','dodo','razorpay','paddle','square','adyen','mollie','chargebee','lemonsqueezy','polar','braintree','cashfree')),
 mode text NOT NULL CHECK(mode IN('test','live')),
 credential_ciphertext text NOT NULL CHECK(credential_ciphertext LIKE 'v2.%' AND length(credential_ciphertext)<=8192),
 key_id text NOT NULL CHECK(key_id ~ '^[a-z0-9]{1,16}$'),
 server_proof_hash text NOT NULL CHECK(server_proof_hash ~ '^[a-f0-9]{64}$'),
 key_hint text NOT NULL DEFAULT '' CHECK(length(key_hint)<=40),
 account_label text CHECK(length(account_label)<=80),
 config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(config)='object' AND length(config::text)<=1000),
 status text NOT NULL DEFAULT 'connected' CHECK(status IN('connected','error')),
 last_checked_at timestamptz,
 live_confirmed_at timestamptz,
 live_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,provider),
 CHECK(mode='test' OR live_confirmed_at IS NOT NULL)
);

-- No FK to billing_connections: lifecycle events survive a disconnect.
CREATE TABLE public.billing_connection_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN('paypal','stripe','dodo','razorpay','paddle','square','adyen','mollie','chargebee','lemonsqueezy','polar','braintree','cashfree')),
 mode text NOT NULL CHECK(mode IN('test','live')),
 event text NOT NULL CHECK(event IN('connected','live_confirmed','check_ok','check_failed','rotated','disconnected')),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX billing_connection_events_ws_time ON public.billing_connection_events(user_id,created_at DESC);

-- One metadata row per verification or lookup. No email, name, card data or reference text.
CREATE TABLE public.billing_lookups(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN('paypal','stripe','dodo','razorpay','paddle','square','adyen','mollie','chargebee','lemonsqueezy','polar','braintree','cashfree')),
 mode text NOT NULL CHECK(mode IN('test','live')),
 kind text NOT NULL CHECK(kind IN('verify','lookup')),
 intent text CHECK(intent IN('order_status','payment_history','failed_payment','invoice','renewal','refund_status')),
 outcome text NOT NULL DEFAULT 'pending' CHECK(outcome IN('pending','verified','mismatch','not_found','answered','no_records','unsupported','provider_error','rate_limited','circuit_open','refused')),
 record_kind text CHECK(length(record_kind)<=20),
 record_ref text CHECK(length(record_ref)<=120),
 record_status text CHECK(length(record_status)<=40),
 amount_minor bigint,
 currency text CHECK(currency ~ '^[A-Z]{3}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 CHECK(kind='lookup' OR intent IS NULL)
);
CREATE INDEX billing_lookups_ws_time ON public.billing_lookups(user_id,created_at DESC);
CREATE INDEX billing_lookups_case ON public.billing_lookups(case_id,created_at);

-- Sealed (server-encrypted) verification scope. Never granted to any client role.
CREATE TABLE public.billing_verifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN('paypal','stripe','dodo','razorpay','paddle','square','adyen','mollie','chargebee','lemonsqueezy','polar','braintree','cashfree')),
 scope jsonb NOT NULL CHECK(jsonb_typeof(scope)='object' AND length(scope::text)<=2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX billing_verifications_case ON public.billing_verifications(case_id,created_at DESC);

ALTER TABLE public.support_requests ADD COLUMN billing_lookup_id uuid REFERENCES public.billing_lookups(id) ON DELETE SET NULL;

ALTER TABLE public.billing_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_connection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_connections,public.billing_connection_events,public.billing_lookups,public.billing_verifications FROM PUBLIC,anon,authenticated;

CREATE POLICY ws_billing_connections ON public.billing_connections FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));
-- Column grant: the ciphertext and proof hash are never readable by a signed-in client.
GRANT SELECT(id,user_id,provider,mode,key_id,key_hint,account_label,config,status,last_checked_at,live_confirmed_at,created_at,updated_at) ON public.billing_connections TO authenticated;
CREATE POLICY ws_billing_connection_events ON public.billing_connection_events FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('admin')));
GRANT SELECT ON public.billing_connection_events TO authenticated;
-- Agents read lookup metadata for the payment attached to a ticket.
CREATE POLICY ws_billing_lookups ON public.billing_lookups FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));
GRANT SELECT ON public.billing_lookups TO authenticated;

CREATE TRIGGER owner_audit AFTER INSERT OR UPDATE OR DELETE ON public.billing_connections FOR EACH ROW EXECUTE FUNCTION public.record_owner_audit();

-- Lifecycle event helper (500 kept per workspace). Internal only.
CREATE FUNCTION public.billing_event(p_ws uuid,p_provider text,p_mode text,p_event text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM billing_connection_events WHERE id IN(SELECT id FROM billing_connection_events WHERE user_id=p_ws ORDER BY created_at DESC,id DESC OFFSET 499);
 INSERT INTO billing_connection_events(user_id,provider,mode,event,actor_id) VALUES(p_ws,p_provider,p_mode,p_event,auth.uid());
END$$;
REVOKE ALL ON FUNCTION public.billing_event(uuid,text,text,text) FROM PUBLIC,anon,authenticated;

-- Owner RPCs. Admin may connect test mode; live mode needs the owner and an explicit confirmation.
CREATE FUNCTION public.save_billing_connection(p_provider text,p_mode text,p_ciphertext text,p_key_id text,p_proof_hash text,p_key_hint text,p_label text,p_config jsonb,p_live_confirm boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();rid uuid;live boolean:=p_mode='live';
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF p_mode IS NULL OR p_mode NOT IN('test','live') THEN RAISE EXCEPTION 'Invalid mode';END IF;
 IF live AND (public.acting_role() IS DISTINCT FROM 'owner' OR p_live_confirm IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Live mode needs the workspace owner''s explicit confirmation';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(ws::text,44));
 INSERT INTO billing_connections(user_id,provider,mode,credential_ciphertext,key_id,server_proof_hash,key_hint,account_label,config,status,last_checked_at,live_confirmed_at,live_confirmed_by)
 VALUES(ws,p_provider,p_mode,p_ciphertext,p_key_id,p_proof_hash,coalesce(p_key_hint,''),p_label,coalesce(p_config,'{}'::jsonb),'connected',now(),CASE WHEN live THEN now() END,CASE WHEN live THEN auth.uid() END)
 ON CONFLICT(user_id,provider) DO UPDATE SET mode=excluded.mode,credential_ciphertext=excluded.credential_ciphertext,key_id=excluded.key_id,server_proof_hash=excluded.server_proof_hash,
  key_hint=excluded.key_hint,account_label=excluded.account_label,config=excluded.config,status='connected',last_checked_at=now(),
  live_confirmed_at=excluded.live_confirmed_at,live_confirmed_by=excluded.live_confirmed_by,updated_at=now()
 RETURNING id INTO rid;
 -- A changed key invalidates every open visitor verification for this provider.
 DELETE FROM billing_verifications WHERE user_id=ws AND provider=p_provider;
 PERFORM public.billing_event(ws,p_provider,p_mode,'connected');
 IF live THEN PERFORM public.billing_event(ws,p_provider,p_mode,'live_confirmed');END IF;
 RETURN rid;
END$$;

CREATE FUNCTION public.rotate_billing_connection(p_provider text,p_ciphertext text,p_key_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();m text;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 UPDATE billing_connections SET credential_ciphertext=p_ciphertext,key_id=p_key_id,updated_at=now() WHERE user_id=ws AND provider=p_provider RETURNING mode INTO m;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM public.billing_event(ws,p_provider,m,'rotated');
 RETURN true;
END$$;

CREATE FUNCTION public.record_billing_check(p_provider text,p_ok boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();m text;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 UPDATE billing_connections SET status=CASE WHEN p_ok THEN 'connected' ELSE 'error' END,last_checked_at=now(),updated_at=now() WHERE user_id=ws AND provider=p_provider RETURNING mode INTO m;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM public.billing_event(ws,p_provider,m,CASE WHEN p_ok THEN 'check_ok' ELSE 'check_failed' END);
 RETURN true;
END$$;

-- Disconnect deletes the row, ciphertext included. The event row stays.
CREATE FUNCTION public.delete_billing_connection(p_provider text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();m text;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 DELETE FROM billing_connections WHERE user_id=ws AND provider=p_provider RETURNING mode INTO m;
 IF NOT FOUND THEN RETURN false;END IF;
 DELETE FROM billing_verifications WHERE user_id=ws AND provider=p_provider;
 PERFORM public.billing_event(ws,p_provider,m,'disconnected');
 RETURN true;
END$$;

-- Server-side decrypt path for owner actions (test, rotate). Needs the server proof.
CREATE FUNCTION public.billing_connection_secret(p_provider text,p_proof text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();b billing_connections;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('admin') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 SELECT * INTO b FROM billing_connections WHERE user_id=ws AND provider=p_provider;
 IF NOT FOUND OR p_proof IS NULL OR encode(sha256(convert_to(p_proof,'UTF8')),'hex')<>b.server_proof_hash THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',b.id,'ciphertext',b.credential_ciphertext,'key_id',b.key_id,'mode',b.mode,'config',b.config);
END$$;

REVOKE ALL ON FUNCTION public.save_billing_connection(text,text,text,text,text,text,text,jsonb,boolean),public.rotate_billing_connection(text,text,text),
 public.record_billing_check(text,boolean),public.delete_billing_connection(text),public.billing_connection_secret(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_billing_connection(text,text,text,text,text,text,text,jsonb,boolean),public.rotate_billing_connection(text,text,text),
 public.record_billing_check(text,boolean),public.delete_billing_connection(text),public.billing_connection_secret(text,text) TO authenticated;

-- Visitor RPCs, keyed by the sha256 of an unexpired case token (the 008/024 pattern).
CREATE FUNCTION public.support_billing_status(p_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'providers',coalesce((SELECT jsonb_agg(jsonb_build_object('provider',b.provider,'mode',b.mode) ORDER BY b.provider) FROM billing_connections b WHERE b.user_id=c.user_id),'[]'::jsonb),
  'verified',(SELECT jsonb_build_object('provider',v.provider,'expiresAt',v.expires_at) FROM billing_verifications v WHERE v.case_id=c.id AND v.expires_at>now() ORDER BY v.created_at DESC LIMIT 1))
 FROM support_cases c WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;

-- Connections with ciphertext only when the server proof matches, plus the active sealed scope.
CREATE FUNCTION public.support_billing_context(p_hash text,p_proof text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;ph text;conns jsonb;
BEGIN
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now();
 IF NOT FOUND THEN RETURN NULL;END IF;
 ph:=CASE WHEN p_proof IS NULL THEN NULL ELSE encode(sha256(convert_to(p_proof,'UTF8')),'hex') END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'provider',b.provider,'mode',b.mode,'ciphertext',b.credential_ciphertext,'keyId',b.key_id,'config',b.config)),'[]'::jsonb) INTO conns
  FROM billing_connections b WHERE b.user_id=c.user_id AND ph IS NOT NULL AND b.server_proof_hash=ph;
 RETURN jsonb_build_object(
  'workspaceId',CASE WHEN jsonb_array_length(conns)>0 THEN c.user_id END,
  'inboxState',c.inbox_state,
  'connections',conns,
  'verification',CASE WHEN jsonb_array_length(conns)>0 THEN (SELECT jsonb_build_object('id',v.id,'provider',v.provider,'scope',v.scope,'expiresAt',v.expires_at) FROM billing_verifications v WHERE v.case_id=c.id AND v.expires_at>now() ORDER BY v.created_at DESC LIMIT 1) END);
END$$;

-- Reserve before any provider call. Persisted limits: per workspace 60 / 10 min and 300 / UTC day,
-- per workspace+provider 30 / 10 min, per case 5 failed verifications and 30 rows in total.
-- Reserve and finish are reachable with the anon key, so both require the server proof: a visitor
-- holding only the case token cannot create, forge or settle a lookup row.
CREATE FUNCTION public.support_billing_reserve(p_hash text,p_proof text,p_kind text,p_provider text,p_intent text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;b billing_connections;rid uuid;t timestamptz:=clock_timestamp();
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('verify','lookup') OR (p_kind='lookup' AND (p_intent IS NULL OR p_intent NOT IN('order_status','payment_history','failed_payment','invoice','renewal','refund_status'))) OR (p_kind='verify' AND p_intent IS NOT NULL) THEN RAISE EXCEPTION 'Invalid billing lookup';END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('id',NULL,'mode',NULL,'refused','case_paused');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,44));
 SELECT * INTO b FROM billing_connections WHERE user_id=c.user_id AND provider=p_provider;
 IF NOT FOUND OR p_proof IS NULL OR encode(sha256(convert_to(p_proof,'UTF8')),'hex')<>b.server_proof_hash THEN RETURN jsonb_build_object('id',NULL,'mode',NULL,'refused','not_connected');END IF;
 IF p_kind='lookup' AND c.inbox_state IN('taken_over','closed') THEN RETURN jsonb_build_object('id',NULL,'mode',NULL,'refused','case_paused');END IF;
 IF p_kind='verify' AND (SELECT count(*) FROM billing_lookups WHERE case_id=c.id AND kind='verify' AND outcome IN('mismatch','not_found'))>=5 THEN RETURN jsonb_build_object('id',NULL,'mode',NULL,'refused','too_many_attempts');END IF;
 IF (SELECT count(*) FROM billing_lookups WHERE case_id=c.id)>=30
  OR (SELECT count(*) FROM billing_lookups WHERE user_id=c.user_id AND created_at>t-interval '10 minutes')>=60
  OR (SELECT count(*) FROM billing_lookups WHERE user_id=c.user_id AND created_at>=(date_trunc('day',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))>=300
  OR (SELECT count(*) FROM billing_lookups WHERE user_id=c.user_id AND provider=p_provider AND created_at>t-interval '10 minutes')>=30
 THEN RETURN jsonb_build_object('id',NULL,'mode',NULL,'refused','rate_limited');END IF;
 DELETE FROM billing_lookups WHERE id IN(SELECT id FROM billing_lookups WHERE user_id=c.user_id ORDER BY created_at DESC,id DESC OFFSET 999);
 INSERT INTO billing_lookups(user_id,case_id,provider,mode,kind,intent) VALUES(c.user_id,c.id,p_provider,b.mode,p_kind,p_intent) RETURNING id INTO rid;
 -- One owner-audit row per lookup (metadata only; visitor actor is NULL).
 PERFORM pg_advisory_xact_lock(hashtextextended(c.user_id::text,42));
 DELETE FROM owner_audit_events WHERE id IN(SELECT id FROM owner_audit_events WHERE user_id=c.user_id ORDER BY created_at DESC,id DESC OFFSET 999);
 INSERT INTO owner_audit_events(user_id,resource,operation,resource_id,actor_id) VALUES(c.user_id,'billing_lookups','INSERT',rid,NULL);
 RETURN jsonb_build_object('id',rid,'mode',b.mode,'refused',NULL);
END$$;

CREATE FUNCTION public.support_billing_finish(p_hash text,p_proof text,p_lookup uuid,p_outcome text,p_record_kind text,p_record_ref text,p_record_status text,p_amount_minor bigint,p_currency text,p_scope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;l billing_lookups;exp timestamptz;
BEGIN
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'expiresAt',NULL);END IF;
 SELECT * INTO l FROM billing_lookups WHERE id=p_lookup AND case_id=c.id AND outcome='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'expiresAt',NULL);END IF;
 -- Only the server (holder of the proof for this provider's connection) may settle a lookup.
 IF p_proof IS NULL OR NOT EXISTS(SELECT 1 FROM billing_connections WHERE user_id=c.user_id AND provider=l.provider AND server_proof_hash=encode(sha256(convert_to(p_proof,'UTF8')),'hex')) THEN
  RETURN jsonb_build_object('ok',false,'expiresAt',NULL);
 END IF;
 IF l.kind='verify' AND p_outcome NOT IN('verified','mismatch','not_found','provider_error','rate_limited','circuit_open','refused')
  OR l.kind='lookup' AND p_outcome NOT IN('answered','no_records','unsupported','provider_error','rate_limited','circuit_open','refused')
  OR p_outcome IS NULL THEN RAISE EXCEPTION 'Invalid billing outcome';END IF;
 -- In-flight suppression: a takeover during the provider call discards the answer.
 IF l.kind='lookup' AND c.inbox_state IN('taken_over','closed') THEN
  UPDATE billing_lookups SET outcome='refused',finished_at=clock_timestamp() WHERE id=l.id;
  RETURN jsonb_build_object('ok',false,'expiresAt',NULL);
 END IF;
 IF p_outcome='verified' AND (p_scope IS NULL OR jsonb_typeof(p_scope)<>'object' OR NOT p_scope ? 'sealed') THEN RAISE EXCEPTION 'Sealed scope required';END IF;
 UPDATE billing_lookups SET outcome=p_outcome,record_kind=left(p_record_kind,20),record_ref=left(p_record_ref,120),record_status=left(p_record_status,40),
  amount_minor=p_amount_minor,currency=CASE WHEN p_currency ~ '^[A-Z]{3}$' THEN p_currency END,finished_at=clock_timestamp() WHERE id=l.id;
 IF p_outcome='verified' THEN
  DELETE FROM billing_verifications WHERE case_id=c.id;
  INSERT INTO billing_verifications(user_id,case_id,provider,scope,expires_at) VALUES(c.user_id,c.id,l.provider,p_scope,least(now()+interval '30 minutes',c.expires_at)) RETURNING expires_at INTO exp;
 END IF;
 RETURN jsonb_build_object('ok',true,'expiresAt',exp);
END$$;

-- Opens the existing refund-review ticket with the payment attached. Never calls a provider.
CREATE FUNCTION public.support_billing_refund_request(p_hash text,p_lookup uuid,p_message text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;rid uuid;
BEGIN
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired demo link';END IF;
 IF p_message IS NULL OR length(trim(p_message)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Invalid request';END IF;
 IF NOT EXISTS(SELECT 1 FROM billing_lookups WHERE id=p_lookup AND case_id=c.id AND outcome IN('verified','answered') AND record_ref IS NOT NULL) THEN RAISE EXCEPTION 'Verified payment lookup required';END IF;
 IF(SELECT count(*) FROM support_requests WHERE case_id=c.id)>=5 THEN RAISE EXCEPTION 'Demo request limit reached';END IF;
 INSERT INTO support_requests(case_id,user_id,kind,message,billing_lookup_id) VALUES(c.id,c.user_id,'refund_request',p_message,p_lookup) RETURNING id INTO rid;
 -- escalate_ticket (031) sets category refund and attention. Mark the review pending (037/043 flag pattern).
 IF (SELECT review_decision FROM support_cases WHERE id=c.id)<>'pending' THEN
  PERFORM set_config('automatepal.review_decision','true',true);
  UPDATE support_cases SET review_decision='pending' WHERE id=c.id;
  PERFORM set_config('automatepal.review_decision','false',true);
 END IF;
 RETURN rid;
END$$;

REVOKE ALL ON FUNCTION public.support_billing_status(text),public.support_billing_context(text,text),public.support_billing_reserve(text,text,text,text,text),
 public.support_billing_finish(text,text,uuid,text,text,text,text,bigint,text,jsonb),public.support_billing_refund_request(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_billing_status(text),public.support_billing_context(text,text),public.support_billing_reserve(text,text,text,text,text),
 public.support_billing_finish(text,text,uuid,text,text,text,text,bigint,text,jsonb),public.support_billing_refund_request(text,uuid,text) TO anon,authenticated;

-- delete_preview_data: the 043 body plus the billing tables (before support_cases).
CREATE OR REPLACE FUNCTION public.delete_preview_data(p_confirmation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=public.acting_workspace();
BEGIN
 IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('owner') THEN RAISE EXCEPTION 'Insufficient role';END IF;
 IF uid IS NULL OR p_confirmation IS DISTINCT FROM 'DELETE MY PREVIEW DATA' THEN RAISE EXCEPTION 'Explicit confirmation required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,0));
 -- Lock reviewed actions before checking, so concurrent confirmation cannot pass the deletion check.
 PERFORM 1 FROM action_proposals WHERE user_id=uid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM proof_operation_locks WHERE user_id=uid) OR EXISTS(SELECT 1 FROM action_proposals WHERE user_id=uid AND status IN('executing','needs_review')) THEN RAISE EXCEPTION 'Reconcile uncertain actions before deleting data';END IF;
 DELETE FROM catalog_ai_budget WHERE user_id=uid;
 DELETE FROM operational_events WHERE user_id=uid;
 DELETE FROM owner_alert_preferences WHERE user_id=uid;
 DELETE FROM owner_alert_checks WHERE user_id=uid;
 DELETE FROM demo_webhooks WHERE user_id=uid;
 DELETE FROM readonly_tokens WHERE user_id=uid;
 DELETE FROM billing_verifications WHERE user_id=uid;
 DELETE FROM billing_lookups WHERE user_id=uid;
 DELETE FROM billing_connection_events WHERE user_id=uid;
 DELETE FROM billing_connections WHERE user_id=uid;
 DELETE FROM support_cases WHERE user_id=uid;
 DELETE FROM knowledge_attempts WHERE user_id=uid;
 DELETE FROM knowledge_documents WHERE user_id=uid;
 DELETE FROM custom_responses WHERE user_id=uid;
 DELETE FROM widget_settings WHERE user_id=uid;
 DELETE FROM proof_contracts WHERE user_id=uid;
 DELETE FROM action_proposals WHERE user_id=uid;
 DELETE FROM billing_events WHERE user_id=uid;
 DELETE FROM owner_audit_events WHERE user_id=uid;
 DELETE FROM workspace_invites WHERE workspace_id=uid;
 DELETE FROM workspace_members WHERE workspace_id=uid;
 RETURN true;
END;
$function$;
