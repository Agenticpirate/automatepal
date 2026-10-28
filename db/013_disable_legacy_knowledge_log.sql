-- Apply only AFTER app uses reserve/finish and hosted acceptance passes.
REVOKE ALL ON FUNCTION public.support_log_knowledge(text,text,boolean,integer) FROM anon,authenticated;
