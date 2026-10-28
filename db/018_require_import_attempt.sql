-- Apply after hosted save_knowledge_attempt acceptance. Wrapper is security-definer;
-- authenticated callers cannot bypass the attempt ledger with the older save RPC.
REVOKE ALL ON FUNCTION public.save_knowledge_source(uuid,timestamptz,text,text,boolean,jsonb) FROM authenticated;
