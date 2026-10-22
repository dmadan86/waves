-- Follow-up turns of the advanced voice assistant ("make it 800", "undo", "at
-- Blue Tokai" about an expense just saved) are outside the monthly command
-- allowance (decision D1) but are not free for anyone: they are a Pro feature,
-- and each one costs an LLM call. So the function that admits one checks the
-- plan itself, in the database, and counts them with two atomic caps:
--
--   * 300 a month per person       (voice_agent_usage.followups)
--   * 3 per expense per 10 minutes (voice_agent_followup_turns)
--
-- Service role only, like waves_voice_agent_quota; the edge function calls it
-- with the verified caller id. A paid subscription or an active Pro trial is
-- admitted; everyone else is refused with reason 'free_tier' and nothing is
-- counted.

ALTER TABLE public.voice_agent_usage
  ADD COLUMN IF NOT EXISTS followups integer NOT NULL DEFAULT 0;
ALTER TABLE public.voice_agent_usage
  DROP CONSTRAINT IF EXISTS voice_agent_usage_followups_nonneg;
ALTER TABLE public.voice_agent_usage
  ADD CONSTRAINT voice_agent_usage_followups_nonneg CHECK (followups >= 0);

-- One row per (person, saved expense id): turns taken in the current window.
-- The id is the client's own text (a personal record cannot be verified here),
-- so it is only ever a counter key, never joined to anything.
CREATE TABLE IF NOT EXISTS public.voice_agent_followup_turns (
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  expense_id   text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  turns        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, expense_id),
  CONSTRAINT voice_agent_followup_turns_id_len CHECK (char_length(expense_id) BETWEEN 1 AND 64),
  CONSTRAINT voice_agent_followup_turns_nonneg CHECK (turns >= 0)
);

-- RLS on and no policy: only the service role (which bypasses it) can touch it.
ALTER TABLE public.voice_agent_followup_turns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_agent_followup_turns TO service_role;

CREATE OR REPLACE FUNCTION public.waves_voice_agent_followup(
  p_profile uuid,
  p_expense_id text,
  p_month_limit integer DEFAULT 300,
  p_expense_limit integer DEFAULT 3,
  p_window_seconds integer DEFAULT 600
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier  text;
  v_used  integer;
  v_turns integer;
BEGIN
  IF p_profile IS NULL OR p_expense_id IS NULL OR char_length(p_expense_id) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'waves_voice_agent_followup needs a profile and an expense id';
  END IF;

  -- The plan, decided here and never by the caller: a paid subscription, or an
  -- active Pro trial. Same rule as waves_voice_agent_quota's 'pro'.
  IF public.waves_pro_trial_active(p_profile) IS NOT NULL THEN
    v_tier := 'pro';
  ELSE
    SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
      INTO v_tier
      FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.status = 'active'
       AND s.store <> 'trial'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
       AND s.tier IN ('plus', 'pro');
  END IF;
  IF v_tier = 'free' THEN
    RETURN jsonb_build_object(
      'used', 0, 'limit', 0, 'tier', 'free', 'allowed', false, 'reason', 'free_tier'
    );
  END IF;

  -- Per expense: reset the window when it has passed, else count up to the cap.
  INSERT INTO public.voice_agent_followup_turns AS t (profile_id, expense_id, window_start, turns)
  VALUES (p_profile, p_expense_id, now(), 1)
  ON CONFLICT (profile_id, expense_id) DO UPDATE
    SET window_start = CASE
          WHEN t.window_start <= now() - make_interval(secs => p_window_seconds) THEN now()
          ELSE t.window_start END,
        turns = CASE
          WHEN t.window_start <= now() - make_interval(secs => p_window_seconds) THEN 1
          ELSE t.turns + 1 END
    WHERE t.window_start <= now() - make_interval(secs => p_window_seconds)
       OR t.turns < p_expense_limit
  RETURNING t.turns INTO v_turns;

  IF v_turns IS NULL THEN
    SELECT COALESCE(sum(f.followups), 0)::integer INTO v_used
      FROM public.voice_agent_usage f WHERE f.profile_id = p_profile AND f.month = v_month;
    RETURN jsonb_build_object(
      'used', COALESCE(v_used, 0), 'limit', p_month_limit, 'tier', v_tier,
      'allowed', false, 'reason', 'expense_cap'
    );
  END IF;

  -- Per month. The turn counted above is taken back if the month is spent, so a
  -- refused turn costs nothing.
  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, followups, updated_at)
  SELECT p_profile, v_month, 0, 1, now()
   WHERE p_month_limit >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET followups = u.followups + 1, updated_at = now()
    WHERE u.followups < p_month_limit
  RETURNING u.followups INTO v_used;

  IF v_used IS NULL THEN
    UPDATE public.voice_agent_followup_turns t
       SET turns = GREATEST(t.turns - 1, 0)
     WHERE t.profile_id = p_profile AND t.expense_id = p_expense_id;
    SELECT f.followups INTO v_used
      FROM public.voice_agent_usage f WHERE f.profile_id = p_profile AND f.month = v_month;
    RETURN jsonb_build_object(
      'used', COALESCE(v_used, 0), 'limit', p_month_limit, 'tier', v_tier,
      'allowed', false, 'reason', 'month_cap'
    );
  END IF;

  -- Housekeeping: this person's windows that closed long ago.
  DELETE FROM public.voice_agent_followup_turns d
   WHERE d.profile_id = p_profile
     AND d.window_start < now() - interval '1 day';

  RETURN jsonb_build_object(
    'used', v_used, 'limit', p_month_limit, 'tier', v_tier, 'allowed', true
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_followup(uuid, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_followup(uuid, text, integer, integer, integer)
  TO service_role;
