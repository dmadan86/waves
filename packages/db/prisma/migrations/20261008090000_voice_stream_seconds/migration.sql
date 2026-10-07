-- Seconds of audio actually streamed to Deepgram through the `voice-stream`
-- relay, per person per UTC month — the billed quantity, measured server-side
-- (the mint count in `stream_mints` only bounds how many streams were opened).
--
-- The relay caps every stream at 20 s of audio, so one call adds at most 20;
-- the function clamps to 0..30 regardless, so a bug cannot inflate the meter.
-- Written by the relay after each stream closes (service role only). The relay
-- logs and ignores a failure here, so deploying the function before this
-- migration is applied is harmless.

ALTER TABLE public.voice_agent_usage
  ADD COLUMN IF NOT EXISTS stream_seconds numeric(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.voice_agent_usage DROP CONSTRAINT IF EXISTS voice_agent_usage_stream_seconds_nonneg;
ALTER TABLE public.voice_agent_usage
  ADD CONSTRAINT voice_agent_usage_stream_seconds_nonneg CHECK (stream_seconds >= 0);

CREATE OR REPLACE FUNCTION public.waves_voice_stream_seconds(
  p_profile uuid,
  p_seconds numeric
) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month   text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_seconds numeric := round(least(greatest(COALESCE(p_seconds, 0), 0), 30), 2);
  v_total   numeric;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_voice_stream_seconds needs a profile';
  END IF;

  -- Upsert: a stream that crosses midnight at a month end lands on the new
  -- month's row, which its mint did not create.
  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_seconds, updated_at)
  VALUES (p_profile, v_month, 0, v_seconds, now())
  ON CONFLICT (profile_id, month) DO UPDATE
    SET stream_seconds = u.stream_seconds + v_seconds, updated_at = now()
  RETURNING u.stream_seconds INTO v_total;

  RETURN v_total;
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_stream_seconds(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_stream_seconds(uuid, numeric) TO service_role;
