-- RevenueCat subscriptions: the webhook's idempotency ledger, its one write
-- path into `subscriptions`, and Plus/Pro read correctly everywhere "paid" is
-- decided.
--
--   * revenuecat_events: one row per RevenueCat event id. A replayed delivery
--     (RevenueCat retries until it gets a 200, and resends on demand) finds its
--     id already here and changes nothing.
--   * subscriptions.store_event_at: when the store event behind the row's
--     current state happened, so a late, older event (a RENEWAL delivered after
--     the EXPIRATION that followed it) cannot bring an ended subscription back.
--   * waves_revenuecat_apply: records the event and applies it in ONE
--     transaction, so an event is either both recorded and applied or neither
--     (and RevenueCat's retry does the work again).
--   * waves_profile_is_paid: paid means an active-or-grace, unexpired row whose
--     tier is plus or pro. It used to ignore tier (a 'free' row counted) and
--     ignored grace (a card retry took the features away mid-retry, which
--     waves_my_plan already refused to do).
--   * waves_my_plan: Pro rows count. `tier` stays 'plus' for any paid row (the
--     device-cap functions and older apps read it as "paid"); the new `plan`
--     key says which paid tier: 'plus' or 'pro'.
--
-- The voice quota (waves_voice_agent_quota / waves_voice_stream_mint) is
-- unchanged: only an active 'pro' row gets the Pro allowance, so Plus keeps the
-- free one, which is the product rule (Plus = paid, without advanced voice).

-- 1. Idempotency ledger ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.revenuecat_events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  app_user_id text,
  -- applied | duplicate is never stored | ignored | stale | unknown_profile
  outcome     text NOT NULL DEFAULT 'applied',
  event_at    timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.revenuecat_events ENABLE ROW LEVEL SECURITY;
-- No policies: nobody but the service role reads or writes it.
REVOKE ALL ON TABLE public.revenuecat_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.revenuecat_events TO service_role;

-- 2. Ordering guard -------------------------------------------------------------

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS store_event_at timestamptz;

-- 3. The webhook's write path ---------------------------------------------------
--
-- p_action is what the edge function decided the event means (pure, unit-tested
-- in supabase/functions/revenuecat-webhook/logic.ts):
--   {"kind":"ignore"}
--   {"kind":"upsert","tier":..,"period":..,"status":..,"current_period_end":..,
--    "store":..,"store_txn_id":..,"price_minor":..,"currency":..,"country_code":..}
--   {"kind":"transfer","from":["<uuid>",..],"to":"<uuid>"}
-- Returns the outcome: applied | duplicate | ignored | stale | unknown_profile.
CREATE OR REPLACE FUNCTION public.waves_revenuecat_apply(
  p_event_id    text,
  p_type        text,
  p_app_user_id text,
  p_event_at    timestamptz,
  p_action      jsonb
) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_kind    text := COALESCE(p_action ->> 'kind', 'ignore');
  v_profile uuid;
  v_from    uuid[];
  v_rows    integer;
  v_outcome text;
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) = 0 THEN
    RAISE EXCEPTION 'waves_revenuecat_apply needs an event id';
  END IF;

  INSERT INTO public.revenuecat_events (id, type, app_user_id, event_at)
  VALUES (p_event_id, p_type, p_app_user_id, p_event_at)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  IF v_kind = 'upsert' THEN
    IF p_app_user_id IS NULL OR p_app_user_id !~ v_uuid_re THEN
      v_outcome := 'unknown_profile';
    ELSE
      SELECT id INTO v_profile FROM public.profiles WHERE id = p_app_user_id::uuid;
      IF NOT FOUND THEN
        v_outcome := 'unknown_profile';
      END IF;
    END IF;

    IF v_outcome IS NULL THEN
      INSERT INTO public.subscriptions AS s (
        profile_id, tier, period, status, current_period_end, store, store_txn_id,
        price_minor, currency, country_code, store_event_at, updated_at
      ) VALUES (
        v_profile,
        p_action ->> 'tier',
        p_action ->> 'period',
        p_action ->> 'status',
        (p_action ->> 'current_period_end')::timestamptz,
        p_action ->> 'store',
        p_action ->> 'store_txn_id',
        (p_action ->> 'price_minor')::bigint,
        p_action ->> 'currency',
        p_action ->> 'country_code',
        p_event_at,
        now()
      )
      ON CONFLICT (store_txn_id) DO UPDATE SET
        profile_id         = EXCLUDED.profile_id,
        tier               = EXCLUDED.tier,
        period             = EXCLUDED.period,
        status             = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        store              = EXCLUDED.store,
        price_minor        = COALESCE(EXCLUDED.price_minor, s.price_minor),
        currency           = COALESCE(EXCLUDED.currency, s.currency),
        country_code       = COALESCE(EXCLUDED.country_code, s.country_code),
        store_event_at     = EXCLUDED.store_event_at,
        updated_at         = now()
      WHERE s.store_event_at IS NULL
         OR EXCLUDED.store_event_at IS NULL
         OR s.store_event_at <= EXCLUDED.store_event_at;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_outcome := CASE WHEN v_rows = 0 THEN 'stale' ELSE 'applied' END;
    END IF;

  ELSIF v_kind = 'transfer' THEN
    IF COALESCE(p_action ->> 'to', '') !~ v_uuid_re THEN
      v_outcome := 'unknown_profile';
    ELSE
      SELECT id INTO v_profile FROM public.profiles WHERE id = (p_action ->> 'to')::uuid;
      IF NOT FOUND THEN
        v_outcome := 'unknown_profile';
      ELSE
        SELECT COALESCE(array_agg(f::uuid), '{}')
          INTO v_from
          FROM jsonb_array_elements_text(COALESCE(p_action -> 'from', '[]'::jsonb)) AS f
         WHERE f ~ v_uuid_re;
        -- Store purchases only: a promo grant belongs to the person it was given to.
        UPDATE public.subscriptions
           SET profile_id = v_profile, store_event_at = p_event_at, updated_at = now()
         WHERE profile_id = ANY (v_from)
           AND profile_id <> v_profile
           AND store <> 'promo';
        v_outcome := 'applied';
      END IF;
    END IF;

  ELSE
    v_outcome := 'ignored';
  END IF;

  UPDATE public.revenuecat_events SET outcome = v_outcome WHERE id = p_event_id;
  RETURN v_outcome;
END
$$;

REVOKE ALL ON FUNCTION public.waves_revenuecat_apply(text, text, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_revenuecat_apply(text, text, text, timestamptz, jsonb)
  TO service_role;

-- 4. "Paid" counts Plus and Pro, and grace ----------------------------------------

CREATE OR REPLACE FUNCTION public.waves_profile_is_paid(p_profile uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.tier IN ('plus', 'pro')
       AND s.status IN ('active', 'grace')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.waves_my_plan(p_profile_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := COALESCE(p_profile_id, public.waves_current_profile_id());
  v_row     record;
  v_plan    text;
BEGIN
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('tier', 'free', 'plan', 'free', 'until', NULL, 'source', 'free', 'scanLimit', 20);
  END IF;

  SELECT period, current_period_end INTO v_row
  FROM public.subscriptions
  WHERE profile_id = v_profile
    AND tier IN ('plus', 'pro')
    -- 'grace' is still paid: the store is retrying a card, and taking the
    -- features away mid-retry punishes somebody whose bank was slow.
    AND status IN ('active', 'grace')
    AND (current_period_end IS NULL OR current_period_end > now())
  -- A lifetime purchase outranks a subscription that expires; otherwise the
  -- one that lasts longest wins. Somebody who bought both should get both.
  ORDER BY (current_period_end IS NULL) DESC, current_period_end DESC NULLS FIRST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('tier', 'free', 'plan', 'free', 'until', NULL, 'source', 'free', 'scanLimit', 20);
  END IF;

  -- Pro if any paid row is Pro: holding both is Pro.
  SELECT CASE WHEN bool_or(tier = 'pro') THEN 'pro' ELSE 'plus' END INTO v_plan
  FROM public.subscriptions
  WHERE profile_id = v_profile
    AND tier IN ('plus', 'pro')
    AND status IN ('active', 'grace')
    AND (current_period_end IS NULL OR current_period_end > now());

  RETURN jsonb_build_object(
    'tier', 'plus',
    'plan', v_plan,
    'until', v_row.current_period_end,
    'source', CASE WHEN v_row.period = 'lifetime' THEN 'lifetime' ELSE 'subscription' END,
    'scanLimit', 300
  );
END
$$;

-- CREATE OR REPLACE keeps the existing grants; restated so the caller model is
-- in this file too.
REVOKE ALL ON FUNCTION public.waves_profile_is_paid(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_profile_is_paid(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_my_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_plan(uuid) TO authenticated, service_role;
