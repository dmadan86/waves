-- Rewarded ads for the Free plan, phase 1. Off by default (feature flag `ads_rewarded`, 0%).
--
-- WHAT. A Free user who hits the AI voice limit (10 a month) or the receipt-scan
-- limit (20 a month) may choose to watch one short rewarded video for 2 more
-- voice commands OR 2 more scans. At most 3 ads a day. Nothing is ever forced and
-- the numbers live in ad_reward_settings so they can be tuned without a release.
--
-- WHO (waves_ads_eligibility). The flag is on for the person (the allowlist, or the
-- flag enabled and inside its rollout, evaluated like `voice_agent`), a real account
-- (not a guest), at least min_account_age_days old, on the Free plan, and NOT in the
-- 15-day Pro trial or its 30-day voice pool, and under the daily cap.
--
-- HOW IT IS CREDITED. The phone never grants anything. AdMob calls the `admob-ssv`
-- edge function (server-side verification, signed by Google); that function calls
-- waves_ads_grant (service role only), which re-checks eligibility and the cap and
-- records one ad_rewards row. transaction_id is UNIQUE, so a replayed callback is a
-- no-op. The credit is then simply part of the monthly allowance:
--   * voice: waves_voice_agent_quota adds the month's 'voice' credit to the Free limit
--   * scans: waves_receipt_scan_quota adds the month's 'scan' credit to the limit
-- so bonus units are used after the monthly allowance, with no extra counter to keep
-- in step, and a refunded command is given back for free.
--
-- VALIDITY. A reward is valid for the calendar month (UTC) it was earned in. One rule,
-- no per-row bookkeeping; an ad watched on the last day buys a command to use right
-- now, which is when people watch them.
--
-- THE DAILY CAP counts ad_rewards rows since 00:00 UTC.
--
-- COST ROUTING. waves_voice_stream_mint now refuses Free (outside the Pro trial and
-- its voice pool): Deepgram streaming is for Plus, Pro and the trial. Free sends the
-- phone's own transcript as text to voice-agent (cheap), so the routing is enforced
-- on the server and not only in the app.
--
-- Everything below is callable by the service role only, except
-- waves_my_ads_status (the app reads its own status).

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE public.ad_reward_settings (
    id                   boolean DEFAULT true NOT NULL,
    voice_per_ad         integer DEFAULT 2 NOT NULL,
    scans_per_ad         integer DEFAULT 2 NOT NULL,
    daily_cap            integer DEFAULT 3 NOT NULL,
    min_account_age_days integer DEFAULT 7 NOT NULL,
    CONSTRAINT ad_reward_settings_pkey PRIMARY KEY (id),
    CONSTRAINT ad_reward_settings_single CHECK (id),
    CONSTRAINT ad_reward_settings_sane CHECK (
      voice_per_ad BETWEEN 0 AND 20 AND scans_per_ad BETWEEN 0 AND 20
      AND daily_cap BETWEEN 0 AND 20 AND min_account_age_days BETWEEN 0 AND 365)
);
INSERT INTO public.ad_reward_settings (id) VALUES (true);

CREATE TABLE public.ad_rewards (
    id             uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id     uuid NOT NULL,
    kind           text NOT NULL,
    amount         integer NOT NULL,
    transaction_id text NOT NULL,
    ad_unit        text NOT NULL,
    created_at     timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ad_rewards_pkey PRIMARY KEY (id),
    CONSTRAINT ad_rewards_transaction_key UNIQUE (transaction_id),
    CONSTRAINT ad_rewards_kind_known CHECK (kind = ANY (ARRAY['voice'::text, 'scan'::text])),
    CONSTRAINT ad_rewards_amount_positive CHECK (amount > 0),
    CONSTRAINT ad_rewards_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ad_rewards_profile_created_idx ON public.ad_rewards USING btree (profile_id, created_at);
CREATE INDEX ad_rewards_created_idx ON public.ad_rewards USING btree (created_at);

-- People the `ads_rewarded` flag is on for regardless of the flag's own
-- enabled / rollout_percent. Service role only.
CREATE TABLE public.ads_allowlist (
    profile_id uuid NOT NULL,
    note       text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ads_allowlist_pkey PRIMARY KEY (profile_id),
    CONSTRAINT ads_allowlist_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE public.ad_reward_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ad_reward_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ad_rewards FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ads_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_reward_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_rewards TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ads_allowlist TO service_role;

-- 2. The flag (off, 0%) ---------------------------------------------------------

INSERT INTO public.feature_flags (key, description, enabled, rollout_percent, variants)
VALUES (
  'ads_rewarded',
  'Rewarded video ads on the Free plan: watch one for 2 more AI voice commands or receipt scans (max 3 a day). Off for everyone except ads_allowlist; enabled + rollout_percent opens it to a percentage.',
  false,
  0,
  ARRAY['control', 'treatment']
)
ON CONFLICT (key) DO NOTHING;

-- 3. Is the flag on for this person? --------------------------------------------

CREATE OR REPLACE FUNCTION public.waves_ads_enabled(p_profile uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_flag public.feature_flags%ROWTYPE;
BEGIN
  IF p_profile IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ads_allowlist WHERE profile_id = p_profile) THEN
    RETURN true;
  END IF;
  SELECT * INTO v_flag FROM public.feature_flags WHERE key = 'ads_rewarded';
  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('ads_rewarded:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

-- 4. Credit read by the quota functions: this month's (UTC) rewards of one kind ---

CREATE OR REPLACE FUNCTION public.waves_ads_bonus(p_profile uuid, p_kind text) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(sum(r.amount), 0)::integer
    FROM public.ad_rewards r
   WHERE r.profile_id = p_profile
     AND r.kind = p_kind
     AND r.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
$$;

-- 5. Eligibility ----------------------------------------------------------------
-- {eligible, reason, usedToday, dailyCap, voicePerAd, scansPerAd}. reason is NULL
-- when eligible, else one of disabled / guest / too_new / trial / paid / capped.
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
  ELSIF COALESCE(public.waves_my_plan(p_profile) ->> 'plan', 'free') <> 'free' THEN
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

-- The app's read of its own status (to decide whether to offer the sheet at all).
CREATE OR REPLACE FUNCTION public.waves_my_ads_status() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT public.waves_ads_eligibility(public.waves_current_profile_id());
$$;

-- 6. The grant (called by admob-ssv after Google's signature checks out) ---------
-- Outcomes: granted / duplicate / capped / ineligible / invalid. Idempotent on
-- transaction_id. A refused callback records nothing.
CREATE OR REPLACE FUNCTION public.waves_ads_grant(
  p_profile uuid,
  p_kind text,
  p_transaction_id text,
  p_ad_unit text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set    public.ad_reward_settings%ROWTYPE;
  v_elig   jsonb;
  v_amount integer;
  v_rows   integer;
BEGIN
  IF p_profile IS NULL OR p_kind NOT IN ('voice', 'scan')
     OR COALESCE(btrim(p_transaction_id), '') = '' OR COALESCE(btrim(p_ad_unit), '') = '' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    RETURN jsonb_build_object('outcome', 'ineligible', 'reason', 'unknown_profile');
  END IF;

  -- One grant at a time per person, so the cap cannot be beaten by parallel callbacks.
  PERFORM pg_advisory_xact_lock(hashtextextended('ads_grant:' || p_profile::text, 0));

  IF EXISTS (SELECT 1 FROM public.ad_rewards WHERE transaction_id = p_transaction_id) THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;

  v_elig := public.waves_ads_eligibility(p_profile);
  IF NOT (v_elig ->> 'eligible')::boolean THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_elig ->> 'reason' = 'capped' THEN 'capped' ELSE 'ineligible' END,
      'reason', v_elig ->> 'reason'
    );
  END IF;

  SELECT * INTO v_set FROM public.ad_reward_settings WHERE id;
  v_amount := CASE p_kind WHEN 'voice' THEN v_set.voice_per_ad ELSE v_set.scans_per_ad END;
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('outcome', 'ineligible', 'reason', 'disabled');
  END IF;

  INSERT INTO public.ad_rewards (profile_id, kind, amount, transaction_id, ad_unit)
  VALUES (p_profile, p_kind, v_amount, p_transaction_id, p_ad_unit)
  ON CONFLICT (transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'granted',
    'kind', p_kind,
    'amount', v_amount,
    'usedToday', (v_elig ->> 'usedToday')::integer + 1,
    'dailyCap', v_set.daily_cap
  );
END
$$;

-- 7. The quotas count the credit ------------------------------------------------
-- waves_voice_agent_quota from 20261015220000_pro_trial, with one change: Free's
-- limit is the free allowance plus this month's ad credit.
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
  v_bonus integer := 0;
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
  IF v_tier = 'free' THEN
    -- Commands earned by watching rewarded ads this month come after the monthly ten.
    v_bonus := public.waves_ads_bonus(p_profile, 'voice');
  END IF;
  v_limit := CASE v_tier WHEN 'pro' THEN p_pro_limit WHEN 'plus' THEN p_plus_limit ELSE p_free_limit + v_bonus END;

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

-- waves_receipt_scan_quota from the baseline, plus this month's scan credit for Free.
CREATE OR REPLACE FUNCTION public.waves_receipt_scan_quota() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_plan  jsonb := public.waves_my_plan();
  v_used  integer := public.waves_scans_used_this_month();
  v_base  integer := (v_plan ->> 'scanLimit')::integer;
  v_bonus integer := 0;
  v_me    uuid := public.waves_current_profile_id();
BEGIN
  IF v_plan ->> 'tier' = 'free' AND v_me IS NOT NULL THEN
    v_bonus := public.waves_ads_bonus(v_me, 'scan');
  END IF;
  RETURN jsonb_build_object(
    'used', v_used,
    'limit', v_base + v_bonus,
    'remaining', greatest(0, v_base + v_bonus - v_used),
    'tier', v_plan ->> 'tier',
    'bonus', v_bonus
  );
END
$$;

-- 8. Deepgram streaming is not for Free ------------------------------------------
-- waves_voice_stream_mint from 20261015220000_pro_trial. New: a person on Free
-- (no paid plan, and not in the Pro trial or its voice pool) is refused before any
-- budget is taken, reason 'free_tier'. Their commands use the phone's own speech
-- recogniser and go to voice-agent as text.
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
    IF v_tier = 'free' THEN
      RETURN jsonb_build_object(
        'mints', 0, 'budget', 0, 'tier', 'free', 'trial', false, 'allowed', false, 'reason', 'free_tier'
      );
    END IF;
    v_budget := CASE v_tier WHEN 'pro' THEN p_pro_budget ELSE p_plus_budget END;
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

-- 9. Admin: rewarded ads per day ---------------------------------------------------
-- One row per day (UTC), newest first, for the last p_days days that had any
-- reward: ads rewarded in total and by kind, the units granted, unique users, and
-- cap hits (people who reached the daily cap that day).
CREATE OR REPLACE FUNCTION public.waves_admin_ads(p_days integer DEFAULT 30) RETURNS TABLE(
  day date,
  rewards bigint,
  voice_rewards bigint,
  scan_rewards bigint,
  voice_units bigint,
  scan_units bigint,
  unique_users bigint,
  cap_hits bigint
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH r AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS d, profile_id, kind, amount
      FROM public.ad_rewards
     WHERE created_at >= now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 30), 365)))
  ),
  per_user AS (
    SELECT d, profile_id, count(*) AS n FROM r GROUP BY d, profile_id
  ),
  cap AS (SELECT daily_cap FROM public.ad_reward_settings WHERE id)
  SELECT r.d AS day,
         count(*)::bigint AS rewards,
         count(*) FILTER (WHERE r.kind = 'voice')::bigint AS voice_rewards,
         count(*) FILTER (WHERE r.kind = 'scan')::bigint AS scan_rewards,
         COALESCE(sum(r.amount) FILTER (WHERE r.kind = 'voice'), 0)::bigint AS voice_units,
         COALESCE(sum(r.amount) FILTER (WHERE r.kind = 'scan'), 0)::bigint AS scan_units,
         count(DISTINCT r.profile_id)::bigint AS unique_users,
         (SELECT count(*) FROM per_user p, cap c WHERE p.d = r.d AND p.n >= c.daily_cap)::bigint AS cap_hits
    FROM r
   GROUP BY r.d
   ORDER BY r.d DESC;
$$;

-- 10. Callers ----------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.waves_ads_enabled(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_ads_bonus(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_ads_eligibility(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_ads_grant(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_admin_ads(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_my_ads_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ads_enabled(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_ads_bonus(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_ads_eligibility(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_ads_grant(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_admin_ads(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer) TO service_role;
-- The app reads its own status; signed-in only.
GRANT EXECUTE ON FUNCTION public.waves_my_ads_status() TO authenticated, service_role;
