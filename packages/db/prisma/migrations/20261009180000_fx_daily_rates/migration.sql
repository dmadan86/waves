-- fx_daily_rates: the fx-rate edge function's own daily cache of mid-market
-- rates, so an upstream outage rarely reaches a person.
--
--   * One row per (from, to, day): the rate a provider published FOR that day.
--     The function writes a row only when the provider's own date equals the
--     day asked for (for "latest": today), so a weekend stand-in or a
--     latest-only provider's answer is never recorded as a past day's rate.
--   * num/den are the exact rational (ADR-003) as decimal-digit text, the same
--     strings `expense_versions.fx` stores; no float ever touches them.
--   * When every provider fails, the newest row for the pair is served flagged
--     `stale`, and the app asks before using it.
--
-- Not user data and not group data: RLS on with no policies, every client
-- grant revoked. Only the service role (the edge function) reads or writes it.
-- No functions are created here.

CREATE TABLE IF NOT EXISTS public.fx_daily_rates (
  from_currency text        NOT NULL CHECK (from_currency ~ '^[A-Z]{3}$'),
  to_currency   text        NOT NULL CHECK (to_currency ~ '^[A-Z]{3}$'),
  day           date        NOT NULL,
  num           text        NOT NULL CHECK (num ~ '^[1-9][0-9]{0,39}$'),
  den           text        NOT NULL CHECK (den ~ '^[1-9][0-9]{0,39}$'),
  source        text        NOT NULL CHECK (source IN ('ecb', 'currency-api', 'exchangerate-api')),
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_daily_rates_pkey PRIMARY KEY (from_currency, to_currency, day),
  CONSTRAINT fx_daily_rates_pair_check CHECK (from_currency <> to_currency)
);

ALTER TABLE public.fx_daily_rates ENABLE ROW LEVEL SECURITY;
-- No policies: nobody but the service role reads or writes it.
REVOKE ALL ON TABLE public.fx_daily_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fx_daily_rates TO service_role;
