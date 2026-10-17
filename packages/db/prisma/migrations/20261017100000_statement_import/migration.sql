-- Bank statement import (the `parse-statement` edge function), server half.
--
-- Builds on the generic meter from 20261012150000_screenshot_import
-- (ai_usage, waves_ai_usage_reserve / _refund) and adds, dark until the flag is
-- turned on for somebody:
--   * the `statement_import` feature flag, seeded OFF;
--   * waves_statement_import_enabled, the one gate (paid people only);
--   * waves_statement_import_quota, the files-a-month meter ('statement_import').
--
-- One FILE is one use of the allowance, however many requests its pages take:
-- the function reserves on a file's first request only, and meters the follow-up
-- requests on a separate, generous 'statement_import_chunks' counter straight
-- through waves_ai_usage_reserve (no new function, no new table).
--
-- Nothing here is readable or writable by a client. The function is the only
-- caller, as the service role. The tester allowlist is the screenshot import's
-- (screenshot_import_allowlist): the same people try the AI imports first.

-- 1. The flag, seeded OFF ----------------------------------------------------

INSERT INTO public.feature_flags (key, description, enabled, rollout_percent)
VALUES (
  'statement_import',
  'Bank statement import (parse-statement edge function). Paid people only. Off for everyone except screenshot_import_allowlist; enabled + rollout_percent opens it to a percentage of paid people.',
  false,
  0
)
ON CONFLICT (key) DO NOTHING;

-- 2. The gate ----------------------------------------------------------------

-- Is statement import on for this person? In order:
--   1. no profile, or a guest (an anonymous sign-in) -> off, even allowlisted;
--   2. allowlisted -> on (testers and promo grants, flag or no flag);
--   3. flag off -> off: the kill switch wins over a subscription;
--   4. not paid (waves_profile_is_paid, any store, promo included, unexpired) -> off;
--   5. otherwise the flag's rollout percentage (the same hash as waves_variant).
CREATE OR REPLACE FUNCTION public.waves_statement_import_enabled(p_profile uuid) RETURNS boolean
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
  SELECT * INTO v_flag FROM public.feature_flags WHERE key = 'statement_import';
  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;
  IF NOT public.waves_profile_is_paid(p_profile) THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('statement_import:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

-- 3. Quota -------------------------------------------------------------------

-- Reserves one statement FILE for the person this calendar month, atomically,
-- and says whether that was allowed. A refused call reserves nothing. Past the
-- gate (paid, or allowlisted) is Pro, at the allowance the function passes in
-- (PRO_MONTHLY_STATEMENT_IMPORTS in packages/core/src/billing/plans.ts), so the
-- number lives in one place.
CREATE OR REPLACE FUNCTION public.waves_statement_import_quota(
  p_profile uuid,
  p_pro_limit integer DEFAULT 30
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN public.waves_ai_usage_reserve(p_profile, 'statement_import', p_pro_limit)
    || jsonb_build_object('tier', 'pro');
END
$$;

-- 4. Caller model: service role only -----------------------------------------
-- (SECURITY DEFINER bypasses RLS; Supabase and Postgres would otherwise leave
-- EXECUTE open to anon and PUBLIC.)

REVOKE ALL ON FUNCTION public.waves_statement_import_enabled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_statement_import_enabled(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_statement_import_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_statement_import_quota(uuid, integer) TO service_role;
