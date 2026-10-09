-- fx_daily_rates: the fx-rate edge function's own daily cache of mid-market
-- rates, so an upstream outage rarely reaches a person.
--
--   * One row per (from, to, day): the rate a provider published FOR that day.
--     The function writes a row only when the provider's own date equals the
--     day asked for (for "latest": today), so a weekend stand-in is never
--     recorded as another day's rate.
--   * First write wins, so only the best source that publishes the pair is
--     written: ECB always; currency-api only when the ECB answered that it
--     does not publish the pair (when the ECB was merely down, the fallback
--     is kept in the function's memory for 15 minutes, never here).
--   * ExchangeRate-API is latest-only, so its answer is no dated day's rate:
--     never written here (memory only), and the source CHECK refuses it.
--   * num/den are the exact rational (ADR-003) as decimal-digit text, the same
--     strings `expense_versions.fx` stores; no float ever touches them.
--   * When every provider fails, the row nearest the asked-for day (newest on
--     or before it, else oldest after it) is served flagged `stale` with its
--     day, and the app asks before using it.
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
  source        text        NOT NULL CHECK (source IN ('ecb', 'currency-api')),
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_daily_rates_pkey PRIMARY KEY (from_currency, to_currency, day),
  CONSTRAINT fx_daily_rates_pair_check CHECK (from_currency <> to_currency)
);

ALTER TABLE public.fx_daily_rates ENABLE ROW LEVEL SECURITY;
-- No policies: nobody but the service role reads or writes it.
REVOKE ALL ON TABLE public.fx_daily_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fx_daily_rates TO service_role;
