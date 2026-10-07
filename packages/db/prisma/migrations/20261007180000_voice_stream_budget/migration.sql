-- A server-enforced monthly budget for live-stream tokens (`voice-stream-token`).
--
-- Each mint opens a Deepgram live stream, which Deepgram bills by the minute.
-- The command allowance (`count`, spent by voice-agent) does not cover it:
-- opening the mic and never finishing a command mints a token and counts
-- nothing. So the mints are counted on their own, on the same per-person,
-- per-UTC-month row, against a budget of 3x the command allowance (free 30,
-- Pro 450; the edge function passes VOICE_STREAM_*_MONTHLY).

ALTER TABLE public.voice_agent_usage
  ADD COLUMN IF NOT EXISTS stream_mints integer NOT NULL DEFAULT 0;

ALTER TABLE public.voice_agent_usage DROP CONSTRAINT IF EXISTS voice_agent_usage_stream_mints_nonneg;
ALTER TABLE public.voice_agent_usage
  ADD CONSTRAINT voice_agent_usage_stream_mints_nonneg CHECK (stream_mints >= 0);

-- Takes ONE stream mint for the person this calendar month, atomically, and says
-- whether that was allowed. A refused call takes nothing. Tier is read exactly
-- as waves_voice_agent_quota reads it (active, unexpired 'pro' -> Pro budget;
-- everyone else the free one).
CREATE OR REPLACE FUNCTION public.waves_voice_stream_mint(
  p_profile uuid,
  p_free_budget integer DEFAULT 30,
  p_pro_budget integer DEFAULT 450
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
  v_budget := CASE WHEN v_tier = 'pro' THEN p_pro_budget ELSE p_free_budget END;

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

REVOKE ALL ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_mint(uuid, integer, integer) TO service_role;
