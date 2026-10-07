-- Pro "advanced voice" (the `voice-agent` edge function), server half, phase 1.
--
-- Adds, all of it dark until the flag is turned on for somebody:
--   * the 'pro' subscription tier (waves_profile_is_paid never looked at tier,
--     so a pro row already counts as paid; only the CHECK refused it);
--   * voice_agent_usage, a per-person calendar-month command counter;
--   * waves_voice_agent_quota / waves_voice_agent_refund, the atomic meter;
--   * the `voice_agent` feature flag (seeded OFF) and voice_agent_allowlist,
--     because feature_flags only supports a percentage rollout and the first
--     testers must be named people, not a hash bucket.
--
-- Nothing here is readable or writable by a client except a person reading
-- their own usage row. The function is the only writer, as the service role.

-- 1. 'pro' tier --------------------------------------------------------------

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_known;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_tier_known CHECK (tier = ANY (ARRAY['free'::text, 'plus'::text, 'pro'::text]));

-- 2. Usage meter -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voice_agent_usage (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- 'YYYY-MM' (UTC). A new month is a new key, so the allowance resets with no cron.
  month      text NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, month),
  CONSTRAINT voice_agent_usage_count_nonneg CHECK (count >= 0),
  CONSTRAINT voice_agent_usage_month_shape CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')
);

ALTER TABLE public.voice_agent_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_agent_usage_select_own ON public.voice_agent_usage;
CREATE POLICY voice_agent_usage_select_own ON public.voice_agent_usage
  FOR SELECT TO authenticated USING (profile_id = public.waves_current_profile_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_agent_usage TO service_role;
GRANT SELECT ON TABLE public.voice_agent_usage TO authenticated;

-- 3. Allowlist for the flag --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voice_agent_allowlist (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on and no policy: only the service role (which bypasses it) can read or write.
ALTER TABLE public.voice_agent_allowlist ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voice_agent_allowlist TO service_role;

-- 4. The flag, seeded OFF ----------------------------------------------------

INSERT INTO public.feature_flags (key, description, enabled, rollout_percent)
VALUES (
  'voice_agent',
  'Pro advanced voice (voice-agent edge function). Off for everyone except voice_agent_allowlist; enabled + rollout_percent opens it to a percentage of people.',
  false,
  0
)
ON CONFLICT (key) DO NOTHING;

-- Is the advanced voice agent on for this person?
--   * a person on voice_agent_allowlist: yes, whatever the flag says (this is
--     how it is tested on a handful of accounts while the flag stays OFF);
--   * otherwise the flag must be enabled and the person's stable bucket
--     (the same hash as waves_variant) under rollout_percent.
-- To pull the feature for an allowlisted person, delete their row.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_enabled(p_profile uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_flag public.feature_flags%ROWTYPE;
BEGIN
  IF p_profile IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.voice_agent_allowlist WHERE profile_id = p_profile) THEN
    RETURN true;
  END IF;
  SELECT * INTO v_flag FROM public.feature_flags WHERE key = 'voice_agent';
  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('voice_agent:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

-- 5. Quota -------------------------------------------------------------------

-- Reserves ONE command for the person this calendar month, atomically, and says
-- whether that was allowed. A refused call reserves nothing.
--   pro  (active, unexpired subscriptions.tier = 'pro', any store incl. promo) -> p_pro_limit
--   plus (active, unexpired, tier = 'plus') and free                          -> p_free_limit
-- The limits are arguments (defaults match VOICE_AGENT_*_MONTHLY in
-- packages/core/src/voice/agentProtocol.ts, which the edge function passes) so
-- the numbers live in one place.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_quota(
  p_profile uuid,
  p_free_limit integer DEFAULT 10,
  p_pro_limit integer DEFAULT 150
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
  v_limit := CASE WHEN v_tier = 'pro' THEN p_pro_limit ELSE p_free_limit END;

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

-- Gives back a reserved command when the provider failed, so a Deepgram or
-- Anthropic outage does not cost the person their allowance. Returns the new
-- count; never goes below zero.
CREATE OR REPLACE FUNCTION public.waves_voice_agent_refund(p_profile uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.voice_agent_usage
     SET count = GREATEST(0, count - 1), updated_at = now()
   WHERE profile_id = p_profile
     AND month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_voice_agent_enabled(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_voice_agent_enabled(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_voice_agent_quota(uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_voice_agent_refund(uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_voice_agent_refund(uuid) TO service_role;

-- 6. The app's own question: is the advanced voice on for me? -----------------
-- The client cannot read the allowlist (service-role only) and the plain flag
-- stays OFF while testers are allowlisted, so the app asks this instead.
CREATE OR REPLACE FUNCTION public.waves_my_voice_agent_enabled() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.waves_voice_agent_enabled(public.waves_current_profile_id()) $$;

REVOKE ALL ON FUNCTION public.waves_my_voice_agent_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_my_voice_agent_enabled() TO authenticated, service_role;
