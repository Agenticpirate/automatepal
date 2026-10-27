CREATE TABLE IF NOT EXISTS public.action_proposals (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 tool text NOT NULL CHECK (tool IN ('create_product','create_plan','create_checkout_order','simulate_subscriber_activity')),
 args jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','executing','completed','cancelled','needs_review'))
);
ALTER TABLE public.action_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_actions ON public.action_proposals;
CREATE POLICY own_actions ON public.action_proposals FOR ALL TO authenticated
 USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
GRANT SELECT,INSERT,UPDATE ON public.action_proposals TO authenticated;
CREATE INDEX IF NOT EXISTS action_proposals_owner ON public.action_proposals(user_id,created_at);
