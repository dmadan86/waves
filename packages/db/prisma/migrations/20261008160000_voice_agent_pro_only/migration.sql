-- Cloud voice is a Pro feature, and never a guest's.
--
-- `waves_voice_agent_enabled` is the one gate every cloud-voice path asks: the
-- app (through `waves_my_voice_agent_enabled`) before it offers the cloud
-- engine, and `voice-agent`, `voice-stream` and `voice-stream-token` before they
-- spend a Deepgram minute or a model call. It used to let in anyone the flag's
-- rollout covered, free tier included (ten commands a month). Now, in order:
--
--   1. no profile, or a guest (an anonymous sign-in) -> off. Even allowlisted:
--      a guest is a device, not a person, and their account may be gone in ten
--      days. A ghost member (no account at all) never reaches here — there is
--      no session to ask with.
--   2. allowlisted -> on (testers and promo grants, flag or no flag).
--   3. flag off -> off: the kill switch still wins over a subscription.
--   4. no active, unexpired 'pro' subscription (any store, promo included) -> off.
--      Plus does not include cloud voice.
--   5. otherwise the flag's rollout percentage, as before.
--
-- The guest test is `waves_is_guest`, which already copes with CI's stub
-- `auth.users` (no `is_anonymous` column there, so nobody is a guest).

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
       AND s.status = 'active'
       AND s.tier = 'pro'
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('voice_agent:' || p_profile::text) < v_flag.rollout_percent;
END
$$;
