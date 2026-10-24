-- Ad gates are opt-in rollout, OFF by default. No deployment is performed here.
ALTER TABLE public.ad_reward_settings
  ADD COLUMN IF NOT EXISTS gap_min integer NOT NULL DEFAULT 3 CHECK (gap_min BETWEEN 3 AND 20),
  ADD COLUMN IF NOT EXISTS gap_max integer NOT NULL DEFAULT 5 CHECK (gap_max BETWEEN 3 AND 20),
  ADD COLUMN IF NOT EXISTS cooldown_seconds integer NOT NULL DEFAULT 180 CHECK (cooldown_seconds BETWEEN 60 AND 86400),
  ADD COLUMN IF NOT EXISTS interstitial_daily_cap integer NOT NULL DEFAULT 3 CHECK (interstitial_daily_cap BETWEEN 0 AND 20),
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS grace_expenses integer NOT NULL DEFAULT 5 CHECK (grace_expenses BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS rewarded_quiet_seconds integer NOT NULL DEFAULT 300 CHECK (rewarded_quiet_seconds BETWEEN 60 AND 86400),
  ADD COLUMN IF NOT EXISTS session_grace_seconds integer NOT NULL DEFAULT 60 CHECK (session_grace_seconds BETWEEN 60 AND 3600),
  ADD COLUMN IF NOT EXISTS session_cap integer NOT NULL DEFAULT 2 CHECK (session_cap BETWEEN 0 AND 20);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_pacing_gap_order'
    AND conrelid = 'public.ad_reward_settings'::regclass) THEN
    ALTER TABLE public.ad_reward_settings ADD CONSTRAINT ad_pacing_gap_order CHECK (gap_min <= gap_max);
  END IF;
END $$;
INSERT INTO public.ad_reward_settings(id) VALUES (true) ON CONFLICT DO NOTHING;
INSERT INTO public.feature_flags(key, description, enabled, rollout_percent, variants)
VALUES ('ads_gates', 'Free-only paced expense interstitials and rewarded group/export gates.', false, 0, ARRAY['control','treatment'])
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ad_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  placement text NOT NULL CHECK (placement IN ('expense_interstitial','group_create_rewarded','export_rewarded','native_list','quota_rewarded')),
  outcome text NOT NULL CHECK (outcome IN ('shown','completed','skipped','failed','blocked_grace')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_events_profile_created_idx ON public.ad_events(profile_id, created_at);
CREATE INDEX IF NOT EXISTS ad_events_created_idx ON public.ad_events(created_at);
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_events FROM PUBLIC, anon, authenticated;
GRANT INSERT (profile_id, placement, outcome) ON public.ad_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_events TO service_role;
DROP POLICY IF EXISTS ad_events_insert_own ON public.ad_events;
CREATE POLICY ad_events_insert_own ON public.ad_events FOR INSERT TO authenticated
WITH CHECK (profile_id = public.waves_current_profile_id());
-- Deliberately no SELECT policy. Analytics are service-role aggregates only.
CREATE OR REPLACE FUNCTION public.waves_log_ad_event(p_placement text, p_outcome text, p_event_id uuid DEFAULT gen_random_uuid(),
 p_occurred_at timestamptz DEFAULT now(), p_profile uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_profile IS NOT NULL AND p_profile <> v_profile THEN RAISE EXCEPTION 'Wrong account'; END IF;
  IF p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid event time';
  END IF;
  INSERT INTO public.ad_events(id, profile_id, placement, outcome, created_at)
    VALUES (p_event_id, v_profile, p_placement, p_outcome, p_occurred_at) ON CONFLICT (id) DO NOTHING;
END $$;

-- The old quota eligibility retains its independent rollout, grace and SSV cap.
-- This companion RPC reuses the same plan/trial/guest checks, but does not make
-- group/export availability depend on quota rewards or the ads_rewarded flag.
CREATE OR REPLACE FUNCTION public.waves_my_ad_gate_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_set public.ad_reward_settings%ROWTYPE;
  v_created timestamptz;
  v_enabled boolean := false;
  v_free boolean := false;
  v_count integer;
  v_last timestamptz;
  v_rewarded timestamptz;
  v_interstitial timestamptz;
BEGIN
  SELECT * INTO v_set FROM public.ad_reward_settings WHERE id;
  SELECT created_at INTO v_created FROM public.profiles WHERE id = v_profile;
  SELECT enabled AND public.waves_bucket('ads_gates:' || v_profile::text) < rollout_percent
    INTO v_enabled FROM public.feature_flags WHERE key = 'ads_gates';
  -- Allowlist is useful for testing rollout, but cannot bypass the master switch.
  v_enabled := COALESCE(v_enabled, false) OR (
    EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'ads_gates' AND enabled)
    AND EXISTS (SELECT 1 FROM public.ads_allowlist WHERE profile_id = v_profile));
  v_free := v_created IS NOT NULL AND NOT public.waves_is_guest(v_profile)
    AND COALESCE(public.waves_my_plan(v_profile)->>'plan','free') = 'free'
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.profile_id = v_profile
      AND s.tier IN ('plus','pro') AND s.status IN ('active','grace')
      AND (s.current_period_end IS NULL OR s.current_period_end > now()))
    AND public.waves_pro_trial_active(v_profile) IS NULL
    AND public.waves_voice_trial_until(v_profile) IS NULL;
  SELECT count(*) FILTER (WHERE placement = 'expense_interstitial' AND outcome = 'shown'
      AND created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),
    max(created_at) FILTER (WHERE outcome IN ('shown','completed','skipped')),
    max(created_at) FILTER (WHERE outcome IN ('shown','completed','skipped') AND placement IN ('quota_rewarded','group_create_rewarded','export_rewarded')),
    max(created_at) FILTER (WHERE outcome IN ('shown','completed','skipped') AND placement = 'expense_interstitial')
    INTO v_count, v_last, v_rewarded, v_interstitial
    FROM public.ad_events WHERE profile_id = v_profile;
  RETURN jsonb_build_object('enabled',v_enabled AND COALESCE(v_free,false),
    'createdAt',v_created,'settings',to_jsonb(v_set), 'interstitialToday',v_count,
    'lastAdAt',v_last,'lastRewardedAt',v_rewarded,'lastInterstitialAt',v_interstitial,
    'createdGroups',(SELECT count(*) FROM public.groups WHERE created_by = v_profile));
END $$;

CREATE OR REPLACE FUNCTION public.waves_admin_ad_events(p_days integer DEFAULT 30)
RETURNS TABLE(day date, placement text, shown bigint, completed bigint, skipped bigint, failed bigint, blocked_grace bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
 SELECT (created_at AT TIME ZONE 'UTC')::date, placement,
 count(*) FILTER (WHERE outcome='shown'), count(*) FILTER (WHERE outcome='completed'),
 count(*) FILTER (WHERE outcome='skipped'), count(*) FILTER (WHERE outcome='failed'),
 count(*) FILTER (WHERE outcome='blocked_grace')
 FROM public.ad_events WHERE created_at >= now() - make_interval(days => LEAST(GREATEST(p_days,1),365))
 GROUP BY 1,2 ORDER BY 1 DESC,2;
$$;
CREATE OR REPLACE FUNCTION public.waves_admin_ad_settings() RETURNS SETOF public.ad_reward_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
 SELECT * FROM public.ad_reward_settings WHERE id;
$$;
CREATE OR REPLACE FUNCTION public.waves_admin_save_ad_settings(p_settings jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
 IF (p_settings->>'gap_min')::integer > (p_settings->>'gap_max')::integer THEN
   RAISE EXCEPTION 'Minimum gap must not exceed maximum';
 END IF;
 UPDATE public.ad_reward_settings SET
 gap_min=(p_settings->>'gap_min')::integer, gap_max=(p_settings->>'gap_max')::integer,
 cooldown_seconds=(p_settings->>'cooldown_seconds')::integer,
 interstitial_daily_cap=(p_settings->>'interstitial_daily_cap')::integer,
 grace_days=(p_settings->>'grace_days')::integer, grace_expenses=(p_settings->>'grace_expenses')::integer,
 rewarded_quiet_seconds=(p_settings->>'rewarded_quiet_seconds')::integer,
 session_grace_seconds=(p_settings->>'session_grace_seconds')::integer, session_cap=(p_settings->>'session_cap')::integer
 WHERE id;
END $$;
REVOKE ALL ON FUNCTION public.waves_log_ad_event(text,text,uuid,timestamptz,uuid), public.waves_my_ad_gate_status(),
 public.waves_admin_ad_events(integer), public.waves_admin_ad_settings(), public.waves_admin_save_ad_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_log_ad_event(text,text,uuid,timestamptz,uuid), public.waves_my_ad_gate_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_ad_events(integer), public.waves_admin_ad_settings(), public.waves_admin_save_ad_settings(jsonb) TO service_role;
