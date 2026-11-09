-- Widget logo (Phase 1). A small raster image per workspace, stored inline (base64) so it needs no storage
-- bucket, served by /api/widget/logo with its own strict headers. PNG, JPEG or WebP only (no SVG: it can
-- carry script), at most 100 KB decoded. The API checks the file's magic bytes; the database checks type
-- and size. logo_version changes on every upload so caches pick up the new image.
ALTER TABLE public.widget_settings ADD COLUMN logo_data text CHECK(logo_data IS NULL OR (length(logo_data)<=136536 AND logo_data ~ '^[A-Za-z0-9+/]+=*$'));
ALTER TABLE public.widget_settings ADD COLUMN logo_type text CHECK(logo_type IS NULL OR logo_type IN('image/png','image/jpeg','image/webp'));
ALTER TABLE public.widget_settings ADD COLUMN logo_version integer NOT NULL DEFAULT 0 CHECK(logo_version>=0);
ALTER TABLE public.widget_settings ADD CONSTRAINT widget_logo_pair CHECK((logo_data IS NULL)=(logo_type IS NULL));

-- Visitor views carry only the version number (null when there is no logo), never the image itself.
CREATE OR REPLACE FUNCTION public.support_case_view_base(p_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('id',c.id,'order',c.order_label,'amount',c.amount,'currency',c.currency,'fictional',c.fictional,'source',c.source,
  'status',CASE WHEN c.source='demo' THEN 'Sandbox fixture - no real order or payment' ELSE 'Website chat' END,'expiresAt',c.expires_at,
  'branding',jsonb_build_object('label',coalesce(s.label,'Site help'),'color',coalesce(s.color,'#233de8'),'initials',coalesce(s.initials,'AP'),'prompts',coalesce(s.prompts,'["Ask a question","Talk to a person"]'::jsonb),
   'logoVersion',CASE WHEN s.logo_data IS NULL THEN NULL ELSE s.logo_version END))
 FROM public.support_cases c LEFT JOIN public.widget_settings s ON s.user_id=c.user_id WHERE c.token_hash=p_hash AND c.expires_at>now();
$$;
REVOKE ALL ON FUNCTION public.support_case_view_base(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.widget_key_view(p_key text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('label',s.label,'color',s.color,'initials',s.initials,'prompts',s.prompts,'controls',s.controls,'mode',CASE WHEN s.public_key LIKE 'pk_test_%' THEN 'test' ELSE 'live' END,
  'logoVersion',CASE WHEN s.logo_data IS NULL THEN NULL ELSE s.logo_version END)
 FROM widget_settings s WHERE s.public_key=p_key AND s.key_active AND p_key ~ '^pk_(live|test)_[A-Za-z0-9]{24}$';
$$;
REVOKE ALL ON FUNCTION public.widget_key_view(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_key_view(text) TO service_role;

-- The image for a key or a live conversation (service role; /api/widget/logo).
CREATE FUNCTION public.widget_logo(p_key text,p_token_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('type',s.logo_type,'data',s.logo_data,'version',s.logo_version)
 FROM widget_settings s
 WHERE s.logo_data IS NOT NULL AND (
  (p_key IS NOT NULL AND s.public_key=p_key AND s.key_active)
  OR (p_token_hash IS NOT NULL AND s.user_id=(SELECT user_id FROM support_cases WHERE token_hash=p_token_hash AND expires_at>now())))
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.widget_logo(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_logo(text,text) TO service_role;

-- Managers set or clear the logo for their acting workspace.
CREATE FUNCTION public.set_widget_logo(p_type text,p_data text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ws uuid:=public.acting_workspace();v integer;
BEGIN
 IF ws IS NULL OR NOT public.workspace_role_at_least('manager') THEN RAISE EXCEPTION 'Manager role required';END IF;
 IF (p_type IS NULL)<>(p_data IS NULL) THEN RAISE EXCEPTION 'Invalid logo';END IF;
 INSERT INTO widget_settings(user_id,logo_type,logo_data,logo_version) VALUES(ws,p_type,p_data,1)
  ON CONFLICT(user_id) DO UPDATE SET logo_type=excluded.logo_type,logo_data=excluded.logo_data,logo_version=widget_settings.logo_version+1
  RETURNING logo_version INTO v;
 RETURN v;
END$$;
REVOKE ALL ON FUNCTION public.set_widget_logo(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_widget_logo(text,text) TO authenticated;
