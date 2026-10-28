-- Fictional sandbox customer cases only. Anonymous access is a short-lived capability,
-- not a customer authentication system or a merchant payment credential.
CREATE TABLE public.support_cases(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 order_label text NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount>0 AND amount<=1000),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 fictional boolean NOT NULL DEFAULT true CHECK(fictional=true)
);
CREATE TABLE public.support_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK(kind IN ('refund_request','receipt_request','billing_question')),
 message text NOT NULL CHECK(length(message) BETWEEN 5 AND 1000),
 status text NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','reviewed_no_action'))
);
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_support_cases ON public.support_cases FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY create_support_cases ON public.support_cases FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id);
CREATE POLICY own_support_requests ON public.support_requests FOR SELECT TO authenticated USING(auth.uid()=user_id);
GRANT SELECT,INSERT ON public.support_cases TO authenticated;
GRANT SELECT ON public.support_requests TO authenticated;
CREATE INDEX support_requests_owner ON public.support_requests(user_id,created_at);
CREATE OR REPLACE FUNCTION public.support_case_view(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',id,'order',order_label,'amount',amount,'currency',currency,'fictional',true,'status','Sandbox fixture - no real order or payment','expiresAt',expires_at)
 FROM public.support_cases WHERE token_hash=p_hash AND expires_at>now();
$$;
CREATE OR REPLACE FUNCTION public.support_case_request(p_hash text,p_kind text,p_message text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.support_cases; rid uuid;
BEGIN
 SELECT * INTO c FROM public.support_cases WHERE token_hash=p_hash AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired demo link'; END IF;
 IF p_kind NOT IN ('refund_request','receipt_request','billing_question') OR length(p_message)<5 OR length(p_message)>1000 THEN RAISE EXCEPTION 'Invalid request'; END IF;
 IF (SELECT count(*) FROM public.support_requests WHERE case_id=c.id)>=5 THEN RAISE EXCEPTION 'Demo request limit reached'; END IF;
 INSERT INTO public.support_requests(case_id,user_id,kind,message) VALUES(c.id,c.user_id,p_kind,p_message) RETURNING id INTO rid;
 RETURN rid;
END;
$$;
CREATE OR REPLACE FUNCTION public.support_review_request(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.support_requests SET status='reviewed_no_action' WHERE id=p_id AND user_id=auth.uid() AND status='pending_review';
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.support_case_view(text),public.support_case_request(text,text,text),public.support_review_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_case_view(text),public.support_case_request(text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_review_request(uuid) TO authenticated;
