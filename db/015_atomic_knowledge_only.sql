-- Apply after atomic-save deployment acceptance.
REVOKE INSERT ON public.knowledge_documents,public.knowledge_chunks FROM authenticated;
