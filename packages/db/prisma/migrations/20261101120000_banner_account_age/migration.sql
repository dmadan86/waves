-- What: banner ads require a configurable minimum account age.
-- Who: eligible Free accounts; allowlisted profiles bypass age for testing.
-- How: extend the self gate status and service-role admin settings RPCs.
ALTER TABLE public.ad_reward_settings
 ADD COLUMN banner_min_account_age_days integer NOT NULL DEFAULT 15 CHECK (banner_min_account_age_days BETWEEN 0 AND 365);

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
    'bannerEligible',COALESCE(v_enabled AND v_free AND (v_created <= now() - make_interval(days => v_set.banner_min_account_age_days)
      OR EXISTS (SELECT 1 FROM public.ads_allowlist WHERE profile_id = v_profile)), false),
    'credits',public.waves_credit_balance(v_profile),'walletCap',v_set.wallet_cap,
    'perAd',v_set.credits_per_ad,'costs',jsonb_build_object('voice',v_set.voice_cost,'scan',v_set.scan_cost,'export',v_set.export_cost,'group',v_set.group_cost),
    'createdAt',v_created,'settings',to_jsonb(v_set), 'interstitialToday',v_count,
    'lastAdAt',v_last,'lastRewardedAt',v_rewarded,'lastInterstitialAt',v_interstitial,
    'createdGroups',(SELECT count(*) FROM public.groups WHERE created_by = v_profile));
END $$;

CREATE OR REPLACE FUNCTION public.waves_admin_save_ad_settings(p_settings jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 UPDATE public.ad_reward_settings SET
 gap_min=COALESCE((p_settings->>'gap_min')::integer,gap_min),
 gap_max=COALESCE((p_settings->>'gap_max')::integer,gap_max),
 cooldown_seconds=COALESCE((p_settings->>'cooldown_seconds')::integer,cooldown_seconds),
 interstitial_daily_cap=COALESCE((p_settings->>'interstitial_daily_cap')::integer,interstitial_daily_cap),
 grace_days=COALESCE((p_settings->>'grace_days')::integer,grace_days),
 grace_expenses=COALESCE((p_settings->>'grace_expenses')::integer,grace_expenses),
 rewarded_quiet_seconds=COALESCE((p_settings->>'rewarded_quiet_seconds')::integer,rewarded_quiet_seconds),
 session_grace_seconds=COALESCE((p_settings->>'session_grace_seconds')::integer,session_grace_seconds),
 session_cap=COALESCE((p_settings->>'session_cap')::integer,session_cap),
 voice_per_ad=COALESCE((p_settings->>'voice_per_ad')::integer,voice_per_ad),
 scans_per_ad=COALESCE((p_settings->>'scans_per_ad')::integer,scans_per_ad),
 daily_cap=COALESCE((p_settings->>'daily_cap')::integer,daily_cap),
 min_account_age_days=COALESCE((p_settings->>'min_account_age_days')::integer,min_account_age_days),
 banner_min_account_age_days=COALESCE((p_settings->>'banner_min_account_age_days')::integer,banner_min_account_age_days),
 credits_per_ad=COALESCE((p_settings->>'credits_per_ad')::integer,credits_per_ad),
 voice_cost=COALESCE((p_settings->>'voice_cost')::integer,voice_cost),
 scan_cost=COALESCE((p_settings->>'scan_cost')::integer,scan_cost),
 export_cost=COALESCE((p_settings->>'export_cost')::integer,export_cost),
 group_cost=COALESCE((p_settings->>'group_cost')::integer,group_cost),
 wallet_cap=COALESCE((p_settings->>'wallet_cap')::integer,wallet_cap),
 rewarded_daily_cap=COALESCE((p_settings->>'rewarded_daily_cap')::integer,rewarded_daily_cap),
 rewarded_hourly_cap=COALESCE((p_settings->>'rewarded_hourly_cap')::integer,rewarded_hourly_cap),
 rewarded_gap_seconds=COALESCE((p_settings->>'rewarded_gap_seconds')::integer,rewarded_gap_seconds),
 voluntary_daily_cap=COALESCE((p_settings->>'voluntary_daily_cap')::integer,voluntary_daily_cap),
 voluntary_weekly_cap=COALESCE((p_settings->>'voluntary_weekly_cap')::integer,voluntary_weekly_cap),
 interstitial_video_enabled=COALESCE((p_settings->>'interstitial_video_enabled')::boolean,interstitial_video_enabled) WHERE id;
END $$;
REVOKE ALL ON FUNCTION public.waves_my_ad_gate_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_my_ad_gate_status() TO authenticated;
REVOKE ALL ON FUNCTION public.waves_admin_save_ad_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_save_ad_settings(jsonb) TO service_role;
