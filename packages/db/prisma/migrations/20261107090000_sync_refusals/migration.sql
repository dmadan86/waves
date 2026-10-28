-- Why the server turned a queued change away. sync_mutations only records
-- successes, so a refusal left no trace in prod. One row per refusal, written by
-- the `sync` edge function (service role). Privacy: kind, code and SQLSTATE only
-- -- never a payload, amount, note or the database's message text.
CREATE TABLE public.sync_refusals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  group_id UUID,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  sqlstate TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_refusals_created_idx ON public.sync_refusals (created_at DESC);
CREATE INDEX sync_refusals_profile_idx ON public.sync_refusals (profile_id, created_at DESC);

ALTER TABLE public.sync_refusals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sync_refusals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.sync_refusals TO service_role;
