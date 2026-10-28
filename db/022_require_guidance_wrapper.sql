-- Apply only after hosted acceptance of the metadata-aware save path.
REVOKE EXECUTE ON FUNCTION public.save_knowledge_attempt(uuid,uuid,timestamptz,text,text,boolean,jsonb) FROM authenticated;
