-- Existing owner choices are preserved. Only empty-workspace fallbacks change.
CREATE OR REPLACE FUNCTION public.support_case_view_base(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',c.id,'order',c.order_label,'amount',c.amount,'currency',c.currency,'fictional',true,'status','Sandbox fixture - no real order or payment','expiresAt',c.expires_at,'branding',jsonb_build_object('label',coalesce(s.label,'Site help'),'color',coalesce(s.color,'#233de8'),'initials',coalesce(s.initials,'AP'),'prompts',coalesce(s.prompts,'["Ask a question","Request refund review","Talk to a person"]'::jsonb)))
 FROM public.support_cases c LEFT JOIN public.widget_settings s ON s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;
REVOKE ALL ON FUNCTION public.support_case_view_base(text) FROM PUBLIC,anon,authenticated;
