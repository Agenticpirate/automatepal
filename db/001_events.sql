-- Apply using the project's SQL editor or a trusted Postgres connection.
-- Every application record belongs to an authenticated user.
CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('simulation', 'paypal_sandbox')),
  kind text NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_events ON public.billing_events;
CREATE POLICY own_events ON public.billing_events
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT ON public.billing_events TO authenticated;
CREATE INDEX IF NOT EXISTS billing_events_owner_ts ON public.billing_events(user_id, ts);
