-- Store only hashes. Preview tokens expose fictional support records, never settings,
-- source text, credentials, contact addresses or payment capabilities.
CREATE TABLE public.readonly_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),token_hash text NOT NULL UNIQUE,scope text NOT NULL CHECK(scope IN('support:read','analytics:read')),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL CHECK(expires_at<=created_at+interval '7 days'),revoked_at timestamptz);
ALTER TABLE public.readonly_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_readonly_tokens ON public.readonly_tokens FOR SELECT TO authenticated USING(user_id=auth.uid());
GRANT SELECT ON public.readonly_tokens TO authenticated;
CREATE FUNCTION public.create_readonly_token(p_label text,p_hash text,p_scope text,p_hours integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
 IF auth.uid() IS NULL OR p_hours NOT BETWEEN 1 AND 168 OR p_scope NOT IN('support:read','analytics:read') OR length(p_label) NOT BETWEEN 1 AND 60 OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid token';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 IF(SELECT count(*) FROM readonly_tokens WHERE user_id=auth.uid() AND revoked_at IS NULL AND expires_at>now())>=5 THEN RAISE EXCEPTION 'Five active tokens maximum';END IF;
 INSERT INTO readonly_tokens(user_id,label,token_hash,scope,expires_at) VALUES(auth.uid(),p_label,p_hash,p_scope,now()+make_interval(hours=>p_hours)) RETURNING id INTO rid;RETURN rid;
END;
$$;
CREATE FUNCTION public.revoke_readonly_token(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN UPDATE readonly_tokens SET revoked_at=now() WHERE id=p_id AND user_id=auth.uid() AND revoked_at IS NULL;RETURN FOUND;END;
$$;
CREATE FUNCTION public.readonly_support_data(p_hash text,p_scope text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid;r jsonb;
BEGIN
 SELECT user_id INTO uid FROM readonly_tokens WHERE token_hash=p_hash AND scope=p_scope AND expires_at>now() AND revoked_at IS NULL;
 IF uid IS NULL THEN RETURN NULL;END IF;
 IF p_scope='support:read' THEN SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO r FROM(SELECT id,created_at,kind,status,case_id FROM support_requests WHERE user_id=uid ORDER BY created_at DESC LIMIT 100)x;
 ELSIF p_scope='analytics:read' THEN SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO r FROM(SELECT id,created_at,supported,source_count,feedback FROM knowledge_interactions WHERE user_id=uid ORDER BY created_at DESC LIMIT 100)x;
 ELSE RETURN NULL;END IF;
 RETURN jsonb_build_object('scope',p_scope,'rows',r,'limit',100,'contains','Fictional demo metadata only; no messages, contacts or source text');
END;
$$;
REVOKE ALL ON FUNCTION public.create_readonly_token(text,text,text,integer),public.revoke_readonly_token(uuid),public.readonly_support_data(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_readonly_token(text,text,text,integer),public.revoke_readonly_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.readonly_support_data(text,text) TO anon,authenticated;
