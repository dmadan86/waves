-- Two tiers: Free and Pro. Plus is retired; every Plus subscriber is Pro.
--
--   Pro: 100 advanced voice commands a month (300 live streams), up from 150
--   Free: 10 a month, unchanged. The Pro trial (20-command pool) is unchanged.
--
-- 'plus' stays a legal value of subscriptions.tier / promo_codes.tier so old
-- rows, old clients and old webhooks stay readable, but it can no longer exist
-- as a stored subscription tier: a trigger writes 'pro' for any 'plus' row, and
-- existing rows are upgraded here. waves_my_plan still answers tier = 'plus'
-- for any paid row (older apps and waves_device_cap read that as "paid"); its
-- `plan` key is 'pro' for every paid row.
--
-- Replaces, each from the latest migration that defined it:
--   waves_my_plan, waves_voice_agent_quota, waves_voice_stream_mint
--                               <- 20261016090000_rewarded_ads / 20261015220000_pro_trial
--   waves_pro_trial_active      <- 20261015220000_pro_trial
--   waves_ads_eligibility       <- 20261016090000_rewarded_ads
--   waves_referral_grant        <- 20261015140000_referral_rewards
--   waves_grant_promo, waves_admin_users <- 20260904000000_waves_baseline
-- and retires the Plus price test (20261015160000_plus_price_test): its flag is
-- switched off at 0% and its read-out function dropped. The `variant` event
-- prop and the flag row stay so history keeps meaning.

-- 1. Plus can no longer be stored ---------------------------------------------
-- Not SECURITY DEFINER: it only rewrites the row being written.
CREATE OR REPLACE FUNCTION public.waves_subscription_plus_is_pro() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.tier = 'plus' THEN
    NEW.tier := 'pro';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS waves_subscription_plus_is_pro ON public.subscriptions;
CREATE TRIGGER waves_subscription_plus_is_pro
  BEFORE INSERT OR UPDATE OF tier ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.waves_subscription_plus_is_pro();

UPDATE public.subscriptions SET tier = 'pro' WHERE tier = 'plus';

-- Referral days are Pro rows now (they were Plus), and they start counting the
-- moment they are written, which can be during the 15-day trial. The trial must
-- not stop being "the trial" because of them, exactly as it did not when they
-- were Plus rows, so a referral grant is not "another Pro" below.
-- waves_pro_trial_active from 20261015220000_pro_trial with that one exclusion.
CREATE OR REPLACE FUNCTION public.waves_pro_trial_active(p_profile uuid) RETURNS timestamptz
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT max(s.current_period_end)
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.store = 'trial' AND s.tier = 'pro' AND s.status = 'active'
     AND s.current_period_end > now()
     AND NOT EXISTS (
       SELECT 1 FROM public.subscriptions o
        WHERE o.profile_id = p_profile
          AND o.store <> 'trial'
          AND o.status IN ('active', 'grace')
          AND (o.current_period_end IS NULL OR o.current_period_end > now())
          AND NOT (o.store = 'promo' AND o.store_txn_id LIKE 'referral:%')
          AND (o.store IN ('play', 'appstore', 'test') AND o.tier IN ('plus', 'pro')
               OR o.tier = 'pro')
     );
$$;

REVOKE ALL ON FUNCTION public.waves_pro_trial_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_pro_trial_active(uuid) TO service_role;

-- Nothing defaults to Plus any more. 'plus' stays a legal value (the CHECKs allow it) so
-- old rows and codes read; promo_codes.tier used to be pinned to 'plus' alone.
ALTER TABLE public.subscriptions ALTER COLUMN tier SET DEFAULT 'pro';
ALTER TABLE public.promo_codes ALTER COLUMN tier SET DEFAULT 'pro';
ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_tier_known;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_tier_known CHECK (tier = ANY (ARRAY['plus'::text, 'pro'::text]));

-- 2. The plan the app reads: every paid row is Pro ------------------------------
-- waves_my_plan from 20261015220000_pro_trial; only `plan` changes.
CREATE OR REPLACE FUNCTION public.waves_my_plan(p_profile_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_role    text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_profile uuid := CASE WHEN v_role IN ('anon', 'authenticated')
                         THEN public.waves_current_profile_id()
                         ELSE COALESCE(p_profile_id, public.waves_current_profile_id()) END;
  v_row     record;
  v_trial   timestamptz;
  v_used    integer;
  v_limit   integer;
  v_out     jsonb;
  v_until   timestamptz;
  v_pool    jsonb := '{}'::jsonb;
BEGIN
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('tier', 'free', 'plan', 'free', 'until', NULL, 'source', 'free', 'scanLimit', 20);
  END IF;

  v_trial := public.waves_pro_trial_active(v_profile);
  v_until := public.waves_voice_trial_until(v_profile);
  IF v_until IS NOT NULL THEN
    SELECT voice_used INTO v_used FROM public.pro_trials WHERE profile_id = v_profile;
    SELECT voice_commands INTO v_limit FROM public.pro_trial_settings WHERE id;
    v_pool := jsonb_build_object(
      'trialVoiceLimit', COALESCE(v_limit, 20),
      'trialVoiceUsed', COALESCE(v_used, 0),
      'trialVoiceUntil', v_until
    );
  END IF;

  SELECT period, current_period_end INTO v_row
  FROM public.subscriptions
  WHERE profile_id = v_profile
    AND tier IN ('plus', 'pro')
    AND status IN ('active', 'grace')
    AND (current_period_end IS NULL OR current_period_end > now())
    AND (store <> 'trial' OR v_trial IS NOT NULL)
  ORDER BY (current_period_end IS NULL) DESC, current_period_end DESC NULLS FIRST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('tier', 'free', 'plan', 'free', 'until', NULL, 'source', 'free', 'scanLimit', 20) || v_pool;
  END IF;

  v_out := jsonb_build_object(
    'tier', 'plus',
    'plan', 'pro',
    'until', v_row.current_period_end,
    'source', CASE WHEN v_row.period = 'lifetime' THEN 'lifetime' ELSE 'subscription' END,
    'scanLimit', 300
  );

  v_out := v_out || v_pool;
  IF v_trial IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('trial', true, 'trialEndsAt', v_trial);
  END IF;
  RETURN v_out;
END
$$;

REVOKE ALL ON FUNCTION public.waves_my_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_plan(uuid) TO authenticated, service_role;

-- 3. Voice: Pro is 100 a month, 300 live streams ---------------------------------
-- p_plus_limit / p_plus_budget stay in the signatures so a caller that still
-- passes them resolves to this function; they are ignored. A paid row of either
-- tier gets the Pro limit.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_quota(
  p_profile uuid,
  p_free_limit integer DEFAULT 10,
  p_pro_limit integer DEFAULT 100,
  p_plus_limit integer DEFAULT 100,
  p_trial_limit integer DEFAULT 20
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier  text;
  v_limit integer;
  v_count integer;
  v_bonus integer := 0;
  v_until timestamptz := public.waves_voice_trial_until(p_profile);
  v_ttier text := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
BEGIN
  IF v_until IS NOT NULL THEN
    UPDATE public.pro_trials
       SET voice_used = voice_used + 1
     WHERE profile_id = p_profile AND voice_used < p_trial_limit
    RETURNING voice_used INTO v_count;
    IF v_count IS NOT NULL THEN
      RETURN jsonb_build_object('used', v_count, 'limit', p_trial_limit, 'tier', v_ttier, 'trial', true, 'until', v_until, 'allowed', true);
    END IF;
    SELECT voice_used INTO v_count FROM public.pro_trials WHERE profile_id = p_profile;
    RETURN jsonb_build_object('used', COALESCE(v_count, 0), 'limit', p_trial_limit, 'tier', v_ttier, 'trial', true, 'until', v_until, 'allowed', false);
  END IF;

  SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status = 'active'
     AND s.store <> 'trial'
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  IF v_tier = 'free' THEN
    v_bonus := public.waves_ads_bonus(p_profile, 'voice');
  END IF;
  v_limit := CASE v_tier WHEN 'pro' THEN p_pro_limit ELSE p_free_limit + v_bonus END;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, updated_at)
  SELECT p_profile, v_month, 1, now()
   WHERE v_limit >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET count = u.count + 1, updated_at = now()
    WHERE u.count < v_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NOT NULL THEN
    RETURN jsonb_build_object('used', v_count, 'limit', v_limit, 'tier', v_tier, 'allowed', true);
  END IF;

  SELECT count INTO v_count
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'used', COALESCE(v_count, 0), 'limit', v_limit, 'tier', v_tier, 'allowed', false
  );
END
$$;

CREATE OR REPLACE FUNCTION public.waves_voice_stream_mint(
  p_profile uuid,
  p_free_budget integer DEFAULT 30,
  p_pro_budget integer DEFAULT 300,
  p_plus_budget integer DEFAULT 300,
  p_trial_budget integer DEFAULT 60
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month  text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier   text;
  v_budget integer;
  v_mints  integer;
  v_trial  boolean := public.waves_voice_trial_until(p_profile) IS NOT NULL;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_stream_mint needs a profile';
  END IF;

  IF v_trial THEN
    v_tier := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
    v_budget := p_trial_budget;
  ELSE
    SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
      INTO v_tier
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status = 'active'
       AND s.store <> 'trial'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.tier IN ('plus', 'pro');
    IF v_tier = 'free' THEN
      RETURN jsonb_build_object(
        'mints', 0, 'budget', 0, 'tier', 'free', 'trial', false, 'allowed', false, 'reason', 'free_tier'
      );
    END IF;
    v_budget := p_pro_budget;
  END IF;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_mints, updated_at)
  SELECT p_profile, v_month, 0, 1, now()
   WHERE v_budget >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_mints = u.stream_mints + 1, updated_at = now()
    WHERE u.stream_mints < v_budget
  RETURNING u.stream_mints INTO v_mints;

  IF v_mints IS NOT NULL THEN
    RETURN jsonb_build_object('mints', v_mints, 'budget', v_budget, 'tier', v_tier, 'trial', v_trial, 'allowed', true);
  END IF;

  SELECT stream_mints INTO v_mints
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'mints', COALESCE(v_mints, 0), 'budget', v_budget, 'tier', v_tier, 'trial', v_trial, 'allowed', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer) TO service_role;

-- 4. Ads: nobody who pays, or is on the trial, is ever offered one ----------------
-- waves_ads_eligibility from 20261016090000_rewarded_ads. Besides the plan
-- (waves_my_plan), it now reads the subscriptions table directly for any active
-- or grace 'plus'/'pro' row, so a legacy Plus row can never be offered an ad
-- even if the plan function changes. Order of reasons is unchanged.
CREATE OR REPLACE FUNCTION public.waves_ads_eligibility(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set     public.ad_reward_settings%ROWTYPE;
  v_created timestamptz;
  v_today   integer := 0;
  v_reason  text;
BEGIN
  SELECT * INTO v_set FROM public.ad_reward_settings WHERE id;
  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_profile;
  IF p_profile IS NOT NULL THEN
    SELECT count(*)::integer INTO v_today
      FROM public.ad_rewards r
     WHERE r.profile_id = p_profile
       AND r.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  END IF;

  IF p_profile IS NULL OR v_created IS NULL OR NOT public.waves_ads_enabled(p_profile) THEN
    v_reason := 'disabled';
  ELSIF public.waves_is_guest(p_profile) THEN
    v_reason := 'guest';
  ELSIF v_created > now() - make_interval(days => v_set.min_account_age_days) THEN
    v_reason := 'too_new';
  ELSIF public.waves_pro_trial_active(p_profile) IS NOT NULL
        OR public.waves_voice_trial_until(p_profile) IS NOT NULL THEN
    v_reason := 'trial';
  ELSIF COALESCE(public.waves_my_plan(p_profile) ->> 'plan', 'free') <> 'free'
        OR EXISTS (
          SELECT 1 FROM public.subscriptions s
           WHERE s.profile_id = p_profile
             AND s.tier IN ('plus', 'pro')
             AND s.status IN ('active', 'grace')
             AND (s.current_period_end IS NULL OR s.current_period_end > now())
        ) THEN
    v_reason := 'paid';
  ELSIF v_today >= v_set.daily_cap THEN
    v_reason := 'capped';
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_reason IS NULL,
    'reason', v_reason,
    'usedToday', v_today,
    'dailyCap', v_set.daily_cap,
    'voicePerAd', v_set.voice_per_ad,
    'scansPerAd', v_set.scans_per_ad
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_ads_eligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ads_eligibility(uuid) TO service_role;

-- 5. Nothing new is granted as Plus ---------------------------------------------------
-- (The trigger above would rewrite it anyway; these say so at the source.)
CREATE OR REPLACE FUNCTION public.waves_referral_grant(p_profile uuid, p_days integer, p_source text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_base timestamptz;
  v_id   uuid;
BEGIN
  IF p_days IS NULL OR p_days <= 0 THEN RETURN NULL; END IF;

  SELECT GREATEST(now(), COALESCE(max(current_period_end), now())) INTO v_base
    FROM public.subscriptions
   WHERE profile_id = p_profile
     AND tier IN ('plus', 'pro')
     AND status IN ('active', 'grace')
     AND current_period_end IS NOT NULL;

  INSERT INTO public.subscriptions
    (profile_id, tier, period, status, current_period_end, store, store_txn_id)
  VALUES (p_profile, 'pro', 'monthly', 'active', v_base + make_interval(days => p_days), 'promo', p_source)
  ON CONFLICT (store_txn_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_referral_grant(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_grant(uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.waves_grant_promo(p_profile_id uuid, p_days integer, p_source text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.subscriptions
    (profile_id, tier, period, status, current_period_end, store, store_txn_id)
  VALUES (
    p_profile_id,
    'pro',
    'monthly',
    'active',
    now() + make_interval(days => p_days),
    'promo',
    p_source
  )
  ON CONFLICT (store_txn_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_grant_promo(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_grant_promo(uuid, integer, text) TO service_role;

-- Screenshot import: past the gate (paid, or allowlisted) is Pro, at the Pro allowance.
-- waves_screenshot_import_quota from 20261012150000_screenshot_import. p_plus_limit
-- stays in the signature (an older edge function still passes it) and is ignored.
CREATE OR REPLACE FUNCTION public.waves_screenshot_import_quota(
  p_profile uuid,
  p_plus_limit integer DEFAULT 100,
  p_pro_limit integer DEFAULT 100
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN public.waves_ai_usage_reserve(p_profile, 'screenshot_import', p_pro_limit)
    || jsonb_build_object('tier', 'pro');
END
$$;

REVOKE ALL ON FUNCTION public.waves_screenshot_import_quota(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_screenshot_import_quota(uuid, integer, integer) TO service_role;

-- 6. Retire the Plus price test ------------------------------------------------------
UPDATE public.feature_flags SET enabled = false, rollout_percent = 0 WHERE key = 'plus_price';
DROP FUNCTION IF EXISTS public.waves_admin_plus_price_results();

-- 7. Admin user list: paid is Pro ------------------------------------------------------
-- waves_admin_users from the baseline; `is_plus` (the column name the console
-- reads) now means "has an active Plus or Pro subscription".
CREATE OR REPLACE FUNCTION public.waves_admin_users(p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_name_prefix text DEFAULT NULL::text, p_country text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_total  bigint := 0;
  v_rows   jsonb  := '[]'::jsonb;
  v_prefix text   := nullif(btrim(coalesce(p_name_prefix, '')), '');
  v_country text  := nullif(upper(btrim(coalesce(p_country, ''))), '');
  -- The page size is clamped so one lookup cannot become a walk of the whole
  -- directory, and the offset floored at zero.
  v_limit  int    := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int    := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'unavailable', 'no auth schema');
  END IF;

  EXECUTE format(
    $q$
      WITH base AS (
        SELECT
          u.id,
          u.email,
          u.phone,
          (u.email_confirmed_at IS NOT NULL)  AS email_confirmed,
          COALESCE(u.is_anonymous, false)     AS is_anonymous,
          u.created_at,
          u.last_sign_in_at,
          p.display_name,
          p.country_code,
          EXISTS (
            SELECT 1 FROM public.subscriptions s
             WHERE s.profile_id = u.id
               AND s.tier IN ('plus', 'pro')
               AND s.status IN ('active', 'grace')
          ) AS is_plus,
          (SELECT count(*) FROM public.device_sessions d
             WHERE d.profile_id = u.id AND d.revoked_at IS NULL) AS device_count,
          (SELECT d.app_version FROM public.device_sessions d
             WHERE d.profile_id = u.id AND d.app_version IS NOT NULL
             ORDER BY d.last_seen_at DESC LIMIT 1) AS app_version,
          (SELECT d.platform FROM public.device_sessions d
             WHERE d.profile_id = u.id
             ORDER BY d.last_seen_at DESC LIMIT 1) AS platform
        FROM auth.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE (%1$L IS NULL OR p.display_name ILIKE %2$L OR u.email ILIKE %2$L)
          AND (%3$L IS NULL OR p.country_code = %3$L)
      )
      SELECT
        (SELECT count(*) FROM base),
        COALESCE(
          (SELECT jsonb_agg(to_jsonb(t))
             FROM (SELECT * FROM base ORDER BY created_at DESC OFFSET %4$s LIMIT %5$s) t),
          '[]'::jsonb
        )
    $q$,
    v_prefix,                 -- %1$L  null check
    v_prefix || '%',          -- %2$L  prefix match (name + email)
    v_country,                -- %3$L  country null check + equality
    v_offset,                 -- %4$s
    v_limit                   -- %5$s
  )
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END
$_$;

REVOKE ALL ON FUNCTION public.waves_admin_users(integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_users(integer, integer, text, text) TO service_role;
