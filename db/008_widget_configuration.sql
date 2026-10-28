-- Tenant settings are owner scoped. Public access requires an unexpired demo case token.
CREATE TABLE public.widget_settings(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 label text NOT NULL DEFAULT 'Billing help' CHECK(length(label) BETWEEN 1 AND 40),
 color text NOT NULL DEFAULT '#233de8' CHECK(color ~ '^#[0-9a-fA-F]{6}$'),
 initials text NOT NULL DEFAULT 'AP' CHECK(length(initials) BETWEEN 1 AND 3),
 prompts jsonb NOT NULL DEFAULT '["Ask about billing","Request refund review","Talk to a person"]' CHECK(jsonb_typeof(prompts)='array' AND jsonb_array_length(prompts)<=4)
);
ALTER TABLE public.widget_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_widget_settings ON public.widget_settings FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE ON public.widget_settings TO authenticated;
ALTER TABLE public.support_requests DROP CONSTRAINT support_requests_kind_check;
ALTER TABLE public.support_requests ADD CONSTRAINT support_requests_kind_check CHECK(kind IN('refund_request','receipt_request','billing_question','human_handoff','lead_callback'));
ALTER TABLE public.support_requests ADD COLUMN contact_email text CHECK(length(contact_email)<=254);
ALTER TABLE public.support_requests ADD COLUMN contact_consent boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_requests ADD CONSTRAINT contact_requires_consent CHECK(contact_email IS NULL OR contact_consent=true);
CREATE OR REPLACE FUNCTION public.support_case_view(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',c.id,'order',c.order_label,'amount',c.amount,'currency',c.currency,'fictional',true,'status','Sandbox fixture - no real order or payment','expiresAt',c.expires_at,'branding',jsonb_build_object('label',coalesce(s.label,'Billing help'),'color',coalesce(s.color,'#233de8'),'initials',coalesce(s.initials,'AP'),'prompts',coalesce(s.prompts,'["Ask about billing","Request refund review","Talk to a person"]'::jsonb)))
 FROM public.support_cases c LEFT JOIN public.widget_settings s ON s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;
-- New signature for explicit consent. Old callers still support billing-only requests.
CREATE OR REPLACE FUNCTION public.support_case_contact(p_hash text,p_kind text,p_message text,p_email text,p_consent boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases;rid uuid;
BEGIN
 SELECT * INTO c FROM public.support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired demo link'; END IF;
 IF p_kind NOT IN('refund_request','receipt_request','billing_question','human_handoff','lead_callback') OR p_message IS NULL OR length(p_message)<5 OR length(p_message)>1000 THEN RAISE EXCEPTION 'Invalid request'; END IF;
 IF p_email IS NOT NULL AND (p_consent IS DISTINCT FROM true OR length(p_email)>254 OR p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'Contact consent required'; END IF;
 IF p_kind='lead_callback' AND p_email IS NULL THEN RAISE EXCEPTION 'Contact required'; END IF;
 IF(SELECT count(*) FROM public.support_requests WHERE case_id=c.id)>=5 THEN RAISE EXCEPTION 'Demo request limit reached'; END IF;
 INSERT INTO public.support_requests(case_id,user_id,kind,message,contact_email,contact_consent) VALUES(c.id,c.user_id,p_kind,p_message,p_email,coalesce(p_consent,false)) RETURNING id INTO rid;RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.support_case_contact(text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_case_contact(text,text,text,text,boolean) TO anon,authenticated;
