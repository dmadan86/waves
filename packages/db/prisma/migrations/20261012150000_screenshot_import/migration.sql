-- Screenshot import (the `import-screenshot` edge function), server half.
--
-- Adds, all of it dark until the flag is turned on for somebody:
--   * ai_usage, a generic per-person calendar-month counter keyed by feature
--     ('screenshot_import' today; receipts and voice can move onto it later);
--   * waves_ai_usage_reserve / waves_ai_usage_refund, the atomic meter, the same
--     shape as waves_voice_agent_quota / _refund;
--   * waves_screenshot_import_quota, that meter with the Plus / Pro allowances;
--   * screenshot_import_allowlist and the `screenshot_import` feature flag
--     (seeded OFF), and waves_screenshot_import_enabled, the one gate.
--
-- Nothing here is readable or writable by a client except a person reading
-- their own usage rows. The function is the only writer, as the service role.

-- 1. Usage meter -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_usage (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- 'YYYY-MM' (UTC). A new month is a new key, so the allowance resets with no cron.
  month      text NOT NULL,
  feature    text NOT NULL,
  count      integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, month, feature),
  CONSTRAINT ai_usage_count_nonneg CHECK (count >= 0),
  CONSTRAINT ai_usage_month_shape CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT ai_usage_feature_shape CHECK (feature ~ '^[a-z][a-z0-9_]{1,60}$')
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_select_own ON public.ai_usage;
CREATE POLICY ai_usage_select_own ON public.ai_usage
  FOR SELECT TO authenticated USING (profile_id = public.waves_current_profile_id());

-- The schema's default privileges hand `authenticated` full DML on new tables;
-- the grant is the boundary here, so say exactly what is allowed.
REVOKE ALL ON TABLE public.ai_usage FROM anon, authenticated;
GRANT SELECT ON TABLE public.ai_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_usage TO service_role;

-- 2. Allowlist for the flag --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.screenshot_import_allowlist (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on and no policy: only the service role (which bypasses it) can read or write.
ALTER TABLE public.screenshot_import_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.screenshot_import_allowlist FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.screenshot_import_allowlist TO service_role;

-- 3. The flag, seeded OFF ----------------------------------------------------

INSERT INTO public.feature_flags (key, description, enabled, rollout_percent)
VALUES (
  'screenshot_import',
  'Screenshot import (import-screenshot edge function). Paid people only. Off for everyone except screenshot_import_allowlist; enabled + rollout_percent opens it to a percentage of paid people.',
  false,
  0
)
ON CONFLICT (key) DO NOTHING;

-- Is screenshot import on for this person? In order:
--   1. no profile, or a guest (an anonymous sign-in) -> off, even allowlisted;
--   2. allowlisted -> on (testers and promo grants, flag or no flag);
--   3. flag off -> off: the kill switch wins over a subscription;
--   4. not paid (waves_profile_is_paid: Plus or Pro, any store, promo included,
--      unexpired) -> off;
--   5. otherwise the flag's rollout percentage (the same hash as waves_variant).
CREATE OR REPLACE FUNCTION public.waves_screenshot_import_enabled(p_profile uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_flag public.feature_flags%ROWTYPE;
BEGIN
  IF p_profile IS NULL OR public.waves_is_guest(p_profile) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.screenshot_import_allowlist WHERE profile_id = p_profile) THEN
    RETURN true;
  END IF;
  SELECT * INTO v_flag FROM public.feature_flags WHERE key = 'screenshot_import';
  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;
  IF NOT public.waves_profile_is_paid(p_profile) THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('screenshot_import:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

-- 4. Quota -------------------------------------------------------------------

-- Reserves ONE use of `p_feature` for the person this calendar month,
-- atomically, and says whether that was allowed. A refused call reserves nothing.
CREATE OR REPLACE FUNCTION public.waves_ai_usage_reserve(
  p_profile uuid,
  p_feature text,
  p_limit integer
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_count integer;
BEGIN
  -- Atomic: the WHERE on the conflict branch means two concurrent calls cannot
  -- both take the last use.
  INSERT INTO public.ai_usage AS u (profile_id, month, feature, count, updated_at)
  SELECT p_profile, v_month, p_feature, 1, now()
   WHERE p_limit >= 1
  ON CONFLICT (profile_id, month, feature) DO UPDATE
    SET count = u.count + 1, updated_at = now()
    WHERE u.count < p_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NOT NULL THEN
    RETURN jsonb_build_object('used', v_count, 'limit', p_limit, 'allowed', true);
  END IF;

  SELECT count INTO v_count
    FROM public.ai_usage
   WHERE profile_id = p_profile AND month = v_month AND feature = p_feature;
  RETURN jsonb_build_object('used', COALESCE(v_count, 0), 'limit', p_limit, 'allowed', false);
END
$$;

--   pro  (active or grace, unexpired subscriptions.tier = 'pro', any store incl. promo) -> p_pro_limit
--   plus, and anyone else who got past the gate (allowlisted)                          -> p_plus_limit
-- The limits are arguments (the edge function passes PLUS_MONTHLY_SCREENSHOT_IMPORTS
-- and PRO_MONTHLY_SCREENSHOT_IMPORTS from packages/core/src/billing/plans.ts) so
-- the numbers live in one place.
CREATE OR REPLACE FUNCTION public.waves_screenshot_import_quota(
  p_profile uuid,
  p_plus_limit integer DEFAULT 30,
  p_pro_limit integer DEFAULT 100
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tier   text;
  v_limit  integer;
  v_result jsonb;
BEGIN
  SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(s.tier = 'pro') THEN 'pro' ELSE 'plus' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status IN ('active', 'grace')
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  v_tier := COALESCE(v_tier, 'plus');
  v_limit := CASE WHEN v_tier = 'pro' THEN p_pro_limit ELSE p_plus_limit END;

  v_result := public.waves_ai_usage_reserve(p_profile, 'screenshot_import', v_limit);
  RETURN v_result || jsonb_build_object('tier', v_tier);
END
$$;

-- Gives back a reserved use when the provider failed, so an outage does not cost
-- the person their allowance. Returns the new count; never goes below zero.
CREATE OR REPLACE FUNCTION public.waves_ai_usage_refund(p_profile uuid, p_feature text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.ai_usage
     SET count = GREATEST(0, count - 1), updated_at = now()
   WHERE profile_id = p_profile
     AND feature = p_feature
     AND month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
  RETURNING count INTO v_count;
  RETURN COALESCE(v_count, 0);
END
$$;

REVOKE ALL ON FUNCTION public.waves_screenshot_import_enabled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_screenshot_import_enabled(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_ai_usage_reserve(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ai_usage_reserve(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_screenshot_import_quota(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_screenshot_import_quota(uuid, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_ai_usage_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ai_usage_refund(uuid, text) TO service_role;
