-- Automatic 15-day Pro trial for first-time users. No card, granted by the server.
--
-- WHO. A newly registered account: not a guest, with a confirmed phone or email
-- (waves_referral_identity, the check the referral reward uses), which became a
-- real account after the trial launched (waves_referral_joined_at, the "joined"
-- moment the referral window uses). Once per person: the sha256 identity keys
-- (phone:<digits> / email:<lowercase>, the referral scheme) are kept in
-- pro_trials, which has NO foreign key to profiles, so deleting an account and
-- signing up again with the same phone or email earns nothing. Accounts that
-- already hold a plan (paid or promo) get no trial and are marked so they cannot
-- get one later. No backfill: accounts that became real before launched_at are
-- ignored.
--
-- WHEN. waves_pro_trial_grant(profile) is the one grant function. It runs from
-- the AFTER INSERT OR UPDATE trigger waves_pro_trial_on_auth_user on auth.users
-- (function waves_pro_trial_after_auth_user), the moment a phone or email is
-- confirmed or an anonymous guest becomes a real account. It never raises into
-- auth. Idempotent: pro_trials.profile_id is the primary key.
--
-- HOW. The existing entitlement model: a subscriptions row, tier 'pro', store
-- 'trial' (new in subscriptions_store_known), store_txn_id 'trial:<profile>',
-- current_period_end = grant + days. Analytics can tell it from promo and paid.
-- A real purchase (play / appstore / test) takes precedence: while one is active
-- the trial row is ignored (waves_my_plan, voice quota). Referral days are
-- unchanged: waves_referral_grant already starts after the latest end date, so
-- they sit after the trial and become the fallback when it ends.
--
-- VOICE. The trial's 20 AI voice commands are one pool for 30 days from the grant
-- (pro_trial_settings.voice_days), not 150 a month; Pro itself lasts 15 days. The
-- pool is used by anyone with no paid plan (it does not stack with Free's 10), also
-- after the Pro days end. When the 20 are spent there is nothing more until day 30;
-- after day 30 the person is on the normal Free rules. A paid plan (or referral Plus
-- days) uses its own monthly allowance instead. Everything else in Pro is unlocked
-- for the 15 days.
--
-- Every function below is SECURITY DEFINER or touches protected tables, and is
-- callable by the service role only (the app reads waves_my_plan).

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_store_known;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_store_known
  CHECK (store = ANY (ARRAY['play'::text, 'appstore'::text, 'promo'::text, 'test'::text, 'trial'::text]));

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE public.pro_trial_settings (
    id             boolean DEFAULT true NOT NULL,
    launched_at    timestamp with time zone DEFAULT now() NOT NULL,
    days           integer DEFAULT 15 NOT NULL,
    voice_commands integer DEFAULT 20 NOT NULL,
    -- How long the trial's voice pool lasts, from the grant.
    voice_days     integer DEFAULT 30 NOT NULL,
    CONSTRAINT pro_trial_settings_pkey PRIMARY KEY (id),
    CONSTRAINT pro_trial_settings_single CHECK (id),
    CONSTRAINT pro_trial_settings_sane CHECK (days BETWEEN 1 AND 90 AND voice_commands >= 0 AND voice_days BETWEEN 1 AND 90)
);
INSERT INTO public.pro_trial_settings (id) VALUES (true);

CREATE TABLE public.pro_trials (
    profile_id    uuid NOT NULL,
    -- 'granted', or 'skipped_has_plan' (already had a plan: marked so a later
    -- login cannot grant one once the plan lapses).
    outcome       text DEFAULT 'granted' NOT NULL,
    granted_at    timestamp with time zone DEFAULT now() NOT NULL,
    expires_at    timestamp with time zone NOT NULL,
    voice_used    integer DEFAULT 0 NOT NULL,
    identity_keys text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT pro_trials_pkey PRIMARY KEY (profile_id),
    CONSTRAINT pro_trials_outcome_known CHECK (outcome = ANY (ARRAY['granted'::text, 'skipped_has_plan'::text])),
    CONSTRAINT pro_trials_voice_nonneg CHECK (voice_used >= 0)
);
CREATE INDEX pro_trials_identity_idx ON public.pro_trials USING gin (identity_keys);

ALTER TABLE public.pro_trial_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pro_trial_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pro_trials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pro_trial_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pro_trials TO service_role;

-- 2. Is the effective Pro a trial? -------------------------------------------
-- The trial's end date when the person's Pro right now comes from the trial:
-- an unexpired trial row, and no real purchase and no other Pro (promo) active.
-- NULL otherwise.
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
          AND (o.store IN ('play', 'appstore', 'test') AND o.tier IN ('plus', 'pro')
               OR o.tier = 'pro')
     );
$$;

-- The end of the trial's voice pool when it is usable right now, else NULL: a
-- granted trial inside its voice window, for someone with no paid plan (or while
-- the trial's own Pro is the effective one). Whether the 20 are used up is the
-- caller's business.
CREATE OR REPLACE FUNCTION public.waves_voice_trial_until(p_profile uuid) RETURNS timestamptz
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT t.granted_at + make_interval(days => st.voice_days)
    FROM public.pro_trials t
    CROSS JOIN public.pro_trial_settings st
   WHERE t.profile_id = p_profile
     AND t.outcome = 'granted'
     AND st.id
     AND now() < t.granted_at + make_interval(days => st.voice_days)
     AND (
       public.waves_pro_trial_active(p_profile) IS NOT NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.subscriptions s
          WHERE s.profile_id = p_profile
            AND s.store <> 'trial'
            AND s.tier IN ('plus', 'pro')
            AND s.status IN ('active', 'grace')
            AND (s.current_period_end IS NULL OR s.current_period_end > now())
       )
     );
$$;

-- 3. The grant ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waves_pro_trial_grant(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set    public.pro_trial_settings%ROWTYPE;
  v_ident  jsonb;
  v_keys   text[];
  v_joined timestamptz;
  v_end    timestamptz;
  v_key    text;
BEGIN
  IF p_profile IS NULL THEN RETURN jsonb_build_object('granted', false, 'reason', 'NONE'); END IF;
  SELECT * INTO v_set FROM public.pro_trial_settings WHERE id;
  IF NOT FOUND THEN RETURN jsonb_build_object('granted', false, 'reason', 'OFF'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'NO_SUCH_PROFILE');
  END IF;
  IF public.waves_is_guest(p_profile) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'GUEST');
  END IF;

  v_ident := public.waves_referral_identity(p_profile);
  IF NOT COALESCE((v_ident ->> 'verified')::boolean, false) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'NOT_VERIFIED');
  END IF;
  SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_keys
    FROM jsonb_array_elements_text(v_ident -> 'keys') k;

  -- No backfill: only accounts that became real after the trial launched.
  v_joined := public.waves_referral_joined_at(p_profile);
  IF v_joined IS NULL OR v_joined < v_set.launched_at THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'EXISTING_ACCOUNT');
  END IF;

  -- Serialise per person and per identity so two sign-ups of one phone or email
  -- cannot both pass the checks below.
  PERFORM pg_advisory_xact_lock(hashtextextended('pro_trial:' || p_profile::text, 0));
  FOREACH v_key IN ARRAY v_keys LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('pro_trial_key:' || v_key, 0));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.pro_trials WHERE profile_id = p_profile) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'ALREADY_GRANTED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pro_trials WHERE identity_keys && v_keys) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'IDENTITY_REUSED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.tier IN ('plus', 'pro')
       AND s.status IN ('active', 'grace')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) THEN
    INSERT INTO public.pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys)
    VALUES (p_profile, 'skipped_has_plan', now(), now(), v_keys)
    ON CONFLICT (profile_id) DO NOTHING;
    RETURN jsonb_build_object('granted', false, 'reason', 'HAS_PLAN');
  END IF;

  v_end := now() + make_interval(days => v_set.days);
  INSERT INTO public.pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys)
  VALUES (p_profile, 'granted', now(), v_end, v_keys);
  INSERT INTO public.subscriptions
    (profile_id, tier, period, status, current_period_end, store, store_txn_id)
  VALUES (p_profile, 'pro', 'monthly', 'active', v_end, 'trial', 'trial:' || p_profile::text)
  ON CONFLICT (store_txn_id) DO NOTHING;

  RETURN jsonb_build_object('granted', true, 'expires_at', v_end, 'days', v_set.days);
END
$$;

-- 4. The trigger: the moment an account becomes verified and real ---------------
CREATE OR REPLACE FUNCTION public.waves_pro_trial_after_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_old jsonb;
  v_new jsonb := to_jsonb(NEW);
  k     text;
  v_changed boolean := TG_OP = 'INSERT';
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD);
      FOREACH k IN ARRAY ARRAY['is_anonymous', 'phone', 'phone_confirmed_at', 'email', 'email_confirmed_at'] LOOP
        IF (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN v_changed := true; END IF;
      END LOOP;
    END IF;
    IF v_changed THEN
      PERFORM public.waves_pro_trial_grant(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pro trial grant failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

-- Guarded on auth.users existing (CI's bare Postgres has none). The name sorts
-- after waves_on_auth_user_created, so the profile row exists when this fires.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'no auth.users (bare Postgres) - pro trial trigger skipped';
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS waves_pro_trial_on_auth_user ON auth.users;
  CREATE TRIGGER waves_pro_trial_on_auth_user
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.waves_pro_trial_after_auth_user();
END
$$;

-- 5. Voice: the trial's 20 commands, a 30-day pool ---------------------------
-- The gate (from 20261015210000_voice_agent_plus) also lets in a person whose
-- trial pool is usable and not spent, so the pool works after the Pro days end.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_enabled(p_profile uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_flag public.feature_flags%ROWTYPE;
BEGIN
  IF p_profile IS NULL OR public.waves_is_guest(p_profile) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.voice_agent_allowlist WHERE profile_id = p_profile) THEN
    RETURN true;
  END IF;
  SELECT * INTO v_flag FROM public.feature_flags WHERE key = 'voice_agent';
  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status IN ('active', 'grace')
       AND s.tier IN ('plus', 'pro')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) AND NOT (
    public.waves_voice_trial_until(p_profile) IS NOT NULL
    AND COALESCE((SELECT voice_used FROM public.pro_trials WHERE profile_id = p_profile), 0)
        < COALESCE((SELECT voice_commands FROM public.pro_trial_settings WHERE id), 20)
  ) THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('voice_agent:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

DROP FUNCTION IF EXISTS public.waves_voice_agent_quota(uuid, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.waves_voice_agent_quota(
  p_profile uuid,
  p_free_limit integer DEFAULT 10,
  p_pro_limit integer DEFAULT 150,
  p_plus_limit integer DEFAULT 50,
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
  v_until timestamptz := public.waves_voice_trial_until(p_profile);
  v_ttier text := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
BEGIN
  -- Inside the trial's voice window, with no paid plan, the allowance is the
  -- trial's one pool of 20 (not a month's, and not on top of Free's). When it is
  -- spent there is nothing more until the window closes.
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

  SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(s.tier = 'pro') THEN 'pro' ELSE 'plus' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status = 'active'
     AND s.store <> 'trial'
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  v_tier := COALESCE(v_tier, 'free');
  v_limit := CASE v_tier WHEN 'pro' THEN p_pro_limit WHEN 'plus' THEN p_plus_limit ELSE p_free_limit END;

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

-- Gives back a reserved command when the provider failed: the trial's counter
-- while the trial is the person's Pro, the month's otherwise. Never below zero.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_refund(p_profile uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  IF public.waves_voice_trial_until(p_profile) IS NOT NULL THEN
    UPDATE public.pro_trials
       SET voice_used = GREATEST(0, voice_used - 1)
     WHERE profile_id = p_profile
    RETURNING voice_used INTO v_count;
    RETURN COALESCE(v_count, 0);
  END IF;
  UPDATE public.voice_agent_usage
     SET count = GREATEST(0, count - 1), updated_at = now()
   WHERE profile_id = p_profile
     AND month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END
$$;

DROP FUNCTION IF EXISTS public.waves_voice_stream_mint(uuid, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.waves_voice_stream_mint(
  p_profile uuid,
  p_free_budget integer DEFAULT 30,
  p_pro_budget integer DEFAULT 450,
  p_plus_budget integer DEFAULT 150,
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
    SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(s.tier = 'pro') THEN 'pro' ELSE 'plus' END
      INTO v_tier
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status = 'active'
       AND s.store <> 'trial'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.tier IN ('plus', 'pro');
    v_tier := COALESCE(v_tier, 'free');
    v_budget := CASE v_tier WHEN 'pro' THEN p_pro_budget WHEN 'plus' THEN p_plus_budget ELSE p_free_budget END;
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

-- 6. The plan the app reads (and no longer anyone else's) ---------------------------------------------------
-- waves_my_plan from 20261008120000_revenuecat_webhook, plus the trial: its
-- row counts unless a real purchase or another Pro is active, and the answer
-- carries trial / trialEndsAt while the trial is the person's Pro, and
-- trialVoiceLimit / trialVoiceUsed / trialVoiceUntil while the voice pool is usable
-- (which outlives the Pro days).
CREATE OR REPLACE FUNCTION public.waves_my_plan(p_profile_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  -- A signed-in caller (PostgREST role anon / authenticated) only ever reads
  -- their OWN plan: p_profile_id is ignored for them. It is honoured for the
  -- service role and for direct database sessions, which carry no client role.
  v_role    text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_profile uuid := CASE WHEN v_role IN ('anon', 'authenticated')
                         THEN public.waves_current_profile_id()
                         ELSE COALESCE(p_profile_id, public.waves_current_profile_id()) END;
  v_row     record;
  v_plan    text;
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
  -- The voice pool outlives the Pro days (30 days from the grant).
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

  SELECT CASE WHEN bool_or(tier = 'pro') THEN 'pro' ELSE 'plus' END INTO v_plan
  FROM public.subscriptions
  WHERE profile_id = v_profile
    AND tier IN ('plus', 'pro')
    AND status IN ('active', 'grace')
    AND (current_period_end IS NULL OR current_period_end > now())
    AND (store <> 'trial' OR v_trial IS NOT NULL);

  v_out := jsonb_build_object(
    'tier', 'plus',
    'plan', v_plan,
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

-- 7. A Pro trial is not a store purchase: the RevenueCat webhook's transfer
-- leaves it with its owner, like a promo grant. waves_revenuecat_apply from
-- 20261008120000_revenuecat_webhook with that one change.
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
        -- Store purchases only: a promo grant or a Pro trial belongs to the person it was given to.
        UPDATE public.subscriptions
           SET profile_id = v_profile, store_event_at = p_event_at, updated_at = now()
         WHERE profile_id = ANY (v_from)
           AND profile_id <> v_profile
           AND store NOT IN ('promo', 'trial');
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

-- 8. Callers --------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.waves_pro_trial_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_voice_trial_until(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_voice_agent_enabled(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_pro_trial_grant(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_pro_trial_after_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_voice_agent_refund(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_revenuecat_apply(text, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_my_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_pro_trial_active(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_trial_until(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_enabled(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_pro_trial_grant(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_refund(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_revenuecat_apply(text, text, text, timestamptz, jsonb) TO service_role;
-- waves_my_plan is the app's read of its own plan.
GRANT EXECUTE ON FUNCTION public.waves_my_plan(uuid) TO authenticated, service_role;
