-- Cloud speech-to-text for everyone signed in. waves_voice_stream_mint no longer
-- refuses Free with 'free_tier': Free draws on p_free_budget (the relay passes a
-- generous per-month clip count, about 100 a day) and the same seconds cap. The
-- agent (Claude) step is still Pro, in voice-agent. Otherwise identical to
-- 20261022100000_atomic_quotas_and_ssv_ledger.
CREATE OR REPLACE FUNCTION public.waves_voice_stream_mint(
  p_profile uuid,
  p_free_budget integer DEFAULT 30,
  p_pro_budget integer DEFAULT 300,
  p_plus_budget integer DEFAULT 300,
  p_trial_budget integer DEFAULT 60,
  p_seconds_budget integer DEFAULT NULL,
  p_reserve_seconds integer DEFAULT 20
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier    text;
  v_budget  integer;
  v_mints   integer;
  v_seconds numeric;
  v_reserve numeric := LEAST(GREATEST(COALESCE(p_reserve_seconds, 20), 0), 30);
  v_cap     numeric;
  v_trial   boolean;
  v_stale   uuid;
  v_id      uuid;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_stream_mint needs a profile';
  END IF;
  PERFORM public.waves_usage_guard(p_profile);
  v_trial := public.waves_voice_trial_until(p_profile) IS NOT NULL;

  -- Reservations a dead relay never settled: release them (0 s streamed).
  FOR v_stale IN
    SELECT id FROM public.voice_stream_reservations
     WHERE profile_id = p_profile AND settled_at IS NULL AND created_at < now() - interval '10 minutes'
  LOOP
    PERFORM public.waves_voice_stream_settle(v_stale, 0);
  END LOOP;

  IF v_trial THEN
    v_tier := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
    v_budget := p_trial_budget;
  ELSE
    SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
      INTO v_tier
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status IN ('active', 'grace')
       AND s.store <> 'trial'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.tier IN ('plus', 'pro');
    -- Free streams too (speech-to-text only; the agent stays Pro): its own budget.
    v_budget := CASE WHEN v_tier = 'free' THEN p_free_budget ELSE p_pro_budget END;
  END IF;
  v_cap := COALESCE(p_seconds_budget, v_budget * 20);

  -- One atomic step: the mint and its seconds, or neither.
  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_mints, stream_seconds, updated_at)
  SELECT p_profile, v_month, 0, 1, v_reserve, now()
   WHERE v_budget >= 1 AND v_reserve <= v_cap
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_mints = u.stream_mints + 1,
        stream_seconds = u.stream_seconds + v_reserve,
        updated_at = now()
    WHERE u.stream_mints < v_budget AND u.stream_seconds + v_reserve <= v_cap
  RETURNING u.stream_mints, u.stream_seconds INTO v_mints, v_seconds;

  IF v_mints IS NOT NULL THEN
    INSERT INTO public.voice_stream_reservations (profile_id, month, seconds)
    VALUES (p_profile, v_month, v_reserve)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object(
      'mints', v_mints, 'budget', v_budget, 'tier', v_tier, 'trial', v_trial, 'allowed', true,
      'reserved_seconds', v_reserve, 'seconds', v_seconds, 'reservation', v_id, 'month', v_month
    );
  END IF;

  SELECT stream_mints, stream_seconds INTO v_mints, v_seconds
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'mints', COALESCE(v_mints, 0), 'budget', v_budget, 'tier', v_tier, 'trial', v_trial, 'allowed', false,
    'reason', CASE WHEN COALESCE(v_mints, 0) >= v_budget THEN 'mint_budget' ELSE 'seconds_budget' END,
    'seconds', COALESCE(v_seconds, 0)
  );
END
$$;

-- Edge-only (the voice-stream relay calls it with the service key), as before.
REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer, integer, integer, integer, integer) TO service_role;
