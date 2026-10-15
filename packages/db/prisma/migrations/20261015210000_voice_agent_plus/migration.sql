-- Advanced AI voice for Plus as well as Pro, with a smaller allowance.
--
--   Plus: 50 commands a month (150 live streams)
--   Pro: 150 commands a month (450 live streams)
--   Free: 10 commands a month, and still no cloud voice (the gate below)
--
-- Replaces three functions, each from the latest migration that defined it:
--   waves_voice_agent_enabled  <- 20261008160000_voice_agent_pro_only
--   waves_voice_agent_quota    <- 20261007120000_voice_agent
--   waves_voice_stream_mint    <- 20261007180000_voice_stream_budget
-- waves_voice_stream_seconds (20261008090000) takes no tier, so it is unchanged.
--
-- The quota and mint functions gain a trailing p_plus_* argument. The old
-- signatures are dropped so a call with the old argument list cannot become
-- ambiguous; an old edge function that still passes three arguments resolves to
-- the new function and gets the Plus default.

-- 1. The gate: plus and pro both qualify -------------------------------------
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
  ) THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('voice_agent:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_enabled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_enabled(uuid) TO service_role;

-- 2. The command quota: a limit per tier -------------------------------------
DROP FUNCTION IF EXISTS public.waves_voice_agent_quota(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.waves_voice_agent_quota(
  p_profile uuid,
  p_free_limit integer DEFAULT 10,
  p_pro_limit integer DEFAULT 150,
  p_plus_limit integer DEFAULT 50
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier  text;
  v_limit integer;
  v_count integer;
BEGIN
  SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(s.tier = 'pro') THEN 'pro' ELSE 'plus' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status = 'active'
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  v_tier := COALESCE(v_tier, 'free');
  v_limit := CASE v_tier WHEN 'pro' THEN p_pro_limit WHEN 'plus' THEN p_plus_limit ELSE p_free_limit END;

  -- Atomic: the WHERE on the conflict branch means two concurrent calls cannot
  -- both take the last command.
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

REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer, integer) TO service_role;

-- 3. The live-stream budget: a budget per tier -------------------------------
DROP FUNCTION IF EXISTS public.waves_voice_stream_mint(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.waves_voice_stream_mint(
  p_profile uuid,
  p_free_budget integer DEFAULT 30,
  p_pro_budget integer DEFAULT 450,
  p_plus_budget integer DEFAULT 150
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month  text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier   text;
  v_budget integer;
  v_mints  integer;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_stream_mint needs a profile';
  END IF;

  SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(s.tier = 'pro') THEN 'pro' ELSE 'plus' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status = 'active'
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  v_tier := COALESCE(v_tier, 'free');
  v_budget := CASE v_tier WHEN 'pro' THEN p_pro_budget WHEN 'plus' THEN p_plus_budget ELSE p_free_budget END;

  -- Atomic, like the command quota: the WHERE on the conflict branch means two
  -- concurrent mints cannot both take the last one.
  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_mints, updated_at)
  SELECT p_profile, v_month, 0, 1, now()
   WHERE v_budget >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_mints = u.stream_mints + 1, updated_at = now()
    WHERE u.stream_mints < v_budget
  RETURNING u.stream_mints INTO v_mints;

  IF v_mints IS NOT NULL THEN
    RETURN jsonb_build_object('mints', v_mints, 'budget', v_budget, 'tier', v_tier, 'allowed', true);
  END IF;

  SELECT stream_mints INTO v_mints
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'mints', COALESCE(v_mints, 0), 'budget', v_budget, 'tier', v_tier, 'allowed', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer) TO service_role;
