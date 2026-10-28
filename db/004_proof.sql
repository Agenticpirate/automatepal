CREATE TABLE IF NOT EXISTS public.proof_contracts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 title text NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount>0 AND amount<=1000),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 pr_url text NOT NULL,
 criteria text NOT NULL,
 required_checks jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','order_created','authorized','captured','voided','needs_review')),
 order_id text,
 authorization_id text
);
CREATE TABLE IF NOT EXISTS public.proof_assessments (
 id uuid PRIMARY KEY,
 contract_id uuid NOT NULL REFERENCES public.proof_contracts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 evidence jsonb NOT NULL,
 assessment jsonb NOT NULL
);
ALTER TABLE public.proof_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_proof_contracts ON public.proof_contracts FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY own_proof_assessments ON public.proof_assessments FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id AND EXISTS(SELECT 1 FROM public.proof_contracts c WHERE c.id=contract_id AND c.user_id=auth.uid()));
GRANT SELECT,INSERT ON public.proof_contracts,public.proof_assessments TO authenticated;
CREATE INDEX proof_contracts_owner ON public.proof_contracts(user_id,created_at);
CREATE INDEX proof_assessments_contract ON public.proof_assessments(contract_id,created_at);
