ALTER TABLE public.action_proposals DROP CONSTRAINT IF EXISTS action_proposals_tool_check;
ALTER TABLE public.action_proposals ADD CONSTRAINT action_proposals_tool_check CHECK(tool IN ('create_product','create_plan','create_checkout_order','simulate_subscriber_activity','proof_create_order','proof_authorize','proof_capture','proof_void'));
