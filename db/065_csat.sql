-- Phase 4 add-on: CSAT. Additive. A visitor rates the whole conversation 1 to 5 from the chat panel (the
-- existing up/down feedback rates one answer). One rating per conversation; rating again replaces it while the
-- conversation link is valid. Score only: no visitor text is stored. Deleted with the conversation.
CREATE TABLE public.case_ratings(
 case_id uuid PRIMARY KEY REFERENCES public.support_cases(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 score smallint NOT NULL CHECK(score BETWEEN 1 AND 5),
 rated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX case_ratings_ws_time ON public.case_ratings(user_id,rated_at DESC);
ALTER TABLE public.case_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_ratings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.case_ratings TO authenticated;
CREATE POLICY ws_case_ratings ON public.case_ratings FOR SELECT TO authenticated
 USING(user_id=(select public.acting_workspace()) AND (select public.workspace_role_at_least('agent')));

-- Visitor (anon, by conversation token hash): rate a conversation that has at least one question, request or
-- person-chat message. Returns false for an unknown or expired link, an empty conversation or a bad score.
CREATE FUNCTION public.support_rate_case(p_hash text,p_score smallint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c support_cases;
BEGIN
 IF p_score IS NULL OR p_score NOT BETWEEN 1 AND 5 THEN RETURN false;END IF;
 SELECT * INTO c FROM support_cases WHERE token_hash=p_hash AND expires_at>now();
 IF NOT FOUND THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM knowledge_interactions WHERE case_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM support_requests WHERE case_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM support_messages WHERE case_id=c.id) THEN RETURN false;END IF;
 INSERT INTO case_ratings(case_id,user_id,score) VALUES(c.id,c.user_id,p_score)
  ON CONFLICT(case_id) DO UPDATE SET score=EXCLUDED.score,rated_at=now();
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.support_rate_case(text,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_rate_case(text,smallint) TO anon,authenticated;
