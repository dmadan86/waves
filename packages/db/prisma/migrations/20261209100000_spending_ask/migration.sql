-- "Ask about my spending" (the `spending-ask` edge function), server half.
--
-- Rides on the generic meter from 20261012150000_screenshot_import
-- (ai_usage, waves_ai_usage_reserve / _refund), exactly as statement import
-- does. Dark until the flag is turned on for somebody:
--   * the `spending_ask` feature flag, seeded OFF;
--   * waves_spending_ask_enabled, the one gate (paid people only);
--   * waves_spending_ask_quota, the questions-a-month meter ('spending_ask').
--
-- Nothing here is readable or writable by a client; the function is the only
-- caller, as the service role. The tester allowlist is the screenshot import's
-- (screenshot_import_allowlist): the same people try the AI features first.

INSERT INTO public.feature_flags (key, description, enabled, rollout_percent)
VALUES (
  'spending_ask',
  'Ask about my spending (spending-ask edge function). Paid people only. Off for everyone except screenshot_import_allowlist; enabled + rollout_percent opens it to a percentage of paid people.',
  false,
  0
)
ON CONFLICT (key) DO NOTHING;

-- Same order as waves_statement_import_enabled: guest -> off; allowlisted -> on;
-- flag off -> off (the kill switch wins); not paid -> off; then the rollout hash.
CREATE OR REPLACE FUNCTION public.waves_spending_ask_enabled(p_profile uuid) RETURNS boolean
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
  SELECT * INTO v_flag FROM public.feature_flags WHERE key = 'spending_ask';
  IF NOT FOUND OR NOT v_flag.enabled THEN
    RETURN false;
  END IF;
  IF NOT public.waves_profile_is_paid(p_profile) THEN
    RETURN false;
  END IF;
  RETURN public.waves_bucket('spending_ask:' || p_profile::text) < v_flag.rollout_percent;
END
$$;

-- Reserves one question for this calendar month, atomically. A refused call
-- reserves nothing. The allowance is PRO_MONTHLY_SPENDING_ASKS in
-- packages/core/src/billing/plans.ts, passed in so the number lives in one place.
CREATE OR REPLACE FUNCTION public.waves_spending_ask_quota(
  p_profile uuid,
  p_pro_limit integer DEFAULT 60
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN public.waves_ai_usage_reserve(p_profile, 'spending_ask', p_pro_limit)
    || jsonb_build_object('tier', 'pro');
END
$$;

REVOKE ALL ON FUNCTION public.waves_spending_ask_enabled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_spending_ask_enabled(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_spending_ask_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_spending_ask_quota(uuid, integer) TO service_role;
