-- Fail-closed per-contract execution lock. An uncertain attempt never auto-expires.
-- A provider/storage failure requires reconciliation before another proposal runs.
CREATE TABLE public.proof_operation_locks(
 contract_id uuid PRIMARY KEY REFERENCES public.proof_contracts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 action_id uuid NOT NULL REFERENCES public.action_proposals(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.proof_operation_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_proof_locks ON public.proof_operation_locks FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.proof_operation_locks TO authenticated;
CREATE OR REPLACE FUNCTION public.proof_claim_operation(p_contract uuid,p_action uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.proof_contracts WHERE id=p_contract AND user_id=auth.uid()) OR NOT EXISTS(
  SELECT 1 FROM public.action_proposals WHERE id=p_action AND user_id=auth.uid() AND status='executing'
  AND tool IN('proof_create_order','proof_authorize','proof_capture','proof_void') AND args->>'contractId'=p_contract::text
 ) THEN RAISE EXCEPTION 'Reviewed executing proof action required'; END IF;
 INSERT INTO public.proof_operation_locks(contract_id,user_id,action_id) VALUES(p_contract,auth.uid(),p_action) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END;
$$;
CREATE OR REPLACE FUNCTION public.proof_finish_operation(p_contract uuid,p_action uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 DELETE FROM public.proof_operation_locks WHERE contract_id=p_contract AND action_id=p_action AND user_id=auth.uid();
 RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.proof_claim_operation(uuid,uuid),public.proof_finish_operation(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proof_claim_operation(uuid,uuid),public.proof_finish_operation(uuid,uuid) TO authenticated;
