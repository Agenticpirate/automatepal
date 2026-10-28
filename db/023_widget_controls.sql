ALTER TABLE public.widget_settings ADD COLUMN controls jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(controls)='object' AND octet_length(controls::text)<=8000);
ALTER TABLE public.widget_settings ALTER COLUMN label SET DEFAULT 'Site help';
ALTER TABLE public.widget_settings ALTER COLUMN prompts SET DEFAULT '["Ask a question","Request refund review","Talk to a person"]';
-- Extend the existing capability-scoped view without adding new account data.
ALTER FUNCTION public.support_case_view(text) RENAME TO support_case_view_base;
CREATE FUNCTION public.support_case_view(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT public.support_case_view_base(p_hash)||jsonb_build_object('controls',coalesce(s.controls,'{}'::jsonb))
 FROM public.support_cases c LEFT JOIN public.widget_settings s ON s.user_id=c.user_id
 WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;
REVOKE ALL ON FUNCTION public.support_case_view(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_case_view(text) TO anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.support_case_view_base(text) FROM anon,authenticated,PUBLIC;
