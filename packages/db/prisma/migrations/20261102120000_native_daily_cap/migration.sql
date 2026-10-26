-- What: native ads have an optional daily impression cap; NULL means unlimited.
-- How: the self gate already returns the full settings row via to_jsonb.
ALTER TABLE public.ad_reward_settings
 ADD COLUMN native_daily_cap integer DEFAULT NULL CHECK (native_daily_cap IS NULL OR native_daily_cap BETWEEN 0 AND 100);

CREATE OR REPLACE FUNCTION public.waves_admin_save_ad_settings(p_settings jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
 UPDATE public.ad_reward_settings SET
 gap_min=COALESCE((p_settings->>'gap_min')::integer,gap_min),
 gap_max=COALESCE((p_settings->>'gap_max')::integer,gap_max),
 cooldown_seconds=COALESCE((p_settings->>'cooldown_seconds')::integer,cooldown_seconds),
 native_daily_cap=CASE WHEN p_settings ? 'native_daily_cap' THEN NULLIF(btrim(p_settings->>'native_daily_cap'),'')::integer ELSE native_daily_cap END,
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
