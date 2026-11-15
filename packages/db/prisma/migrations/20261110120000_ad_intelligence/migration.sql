-- Ad intelligence: per-surface placement config, click/paid events, cross-device passive count.
-- Safe to run before the app update: old clients ignore the new keys and columns.
ALTER TABLE public.ad_reward_settings ADD COLUMN IF NOT EXISTS placements jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ad_events DROP CONSTRAINT IF EXISTS ad_events_placement_check;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_placement_check CHECK (placement IN
 ('expense_interstitial','group_create_rewarded','export_rewarded','native_list','quota_rewarded','credit_voluntary','credit_offer','review_banner','home_banner','activity_banner','voice_banner','settings_banner'));
ALTER TABLE public.ad_events DROP CONSTRAINT IF EXISTS ad_events_outcome_check;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_outcome_check CHECK (outcome IN ('shown','completed','skipped','failed','blocked_grace','offline_allowed','owed_offered','owed_declined','blocked_adblock','credit_used','credit_earned','offline_capped','clicked','paid'));

-- Mirrors validatePlacements in packages/core/src/ads/placements.ts.
CREATE OR REPLACE FUNCTION public.waves_validate_placements(p jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
 k text; v jsonb; sn text; sv jsonb; f text; fv jsonb;
 g constant jsonb := '{"session_cap_min":[0,30],"session_cap_max":[0,30],"daily_cap":[0,100],"session_idle_reset_seconds":[300,7200],"session_grace_seconds":[0,300],"earn_seconds_per_impression":[0,600],"dwell_min_seconds":[0,60],"dwell_max_seconds":[0,60],"visit_cap_default":[1,10],"failure_backoff_seconds":[60,3600],"remove_ads_quiet_hours":[0,168],"light_tenure_days":[0,365],"light_sessions_per_day":[0,50]}';
 s constant jsonb := '{"min_rows":[1,200],"first_min":[3,100],"first_max":[3,100],"gap_min":[10,40],"gap_max":[10,40],"visit_cap":[1,10],"footer_banner_min_rows":[1,200]}';
BEGIN
 IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RAISE EXCEPTION 'Placement settings must be an object'; END IF;
 FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
  IF k = 'surfaces' THEN CONTINUE; END IF;
  IF NOT g ? k THEN RAISE EXCEPTION 'Unknown placement setting %', k; END IF;
  IF jsonb_typeof(v) <> 'number' OR (v#>>'{}')::numeric <> trunc((v#>>'{}')::numeric)
    OR (v#>>'{}')::numeric < (g->k->>0)::numeric OR (v#>>'{}')::numeric > (g->k->>1)::numeric THEN
   RAISE EXCEPTION 'Placement setting % is out of range', k;
  END IF;
 END LOOP;
 IF COALESCE((p->>'session_cap_min')::int,4) > COALESCE((p->>'session_cap_max')::int,7) THEN RAISE EXCEPTION 'session_cap_min is above session_cap_max'; END IF;
 IF COALESCE((p->>'dwell_min_seconds')::int,2) > COALESCE((p->>'dwell_max_seconds')::int,6) THEN RAISE EXCEPTION 'dwell_min_seconds is above dwell_max_seconds'; END IF;
 IF NOT p ? 'surfaces' THEN RETURN; END IF;
 IF jsonb_typeof(p->'surfaces') <> 'object' THEN RAISE EXCEPTION 'surfaces must be an object'; END IF;
 FOR sn, sv IN SELECT * FROM jsonb_each(p->'surfaces') LOOP
  IF sn NOT IN ('home_groups','groups_all','group_expenses','activity','timeline_list','friends','voice_idle','settings') THEN
   RAISE EXCEPTION 'Unknown surface %', sn;
  END IF;
  IF jsonb_typeof(sv) <> 'object' THEN RAISE EXCEPTION 'Surface % must be an object', sn; END IF;
  FOR f, fv IN SELECT * FROM jsonb_each(sv) LOOP
   IF f = 'enabled' THEN
    IF jsonb_typeof(fv) <> 'boolean' THEN RAISE EXCEPTION 'Surface % enabled must be a boolean', sn; END IF;
   ELSIF s ? f THEN
    IF sn = 'home_groups' AND f = 'min_rows' AND jsonb_typeof(fv) = 'number' AND (fv#>>'{}')::numeric < 10 THEN
     RAISE EXCEPTION 'Home needs at least 10 groups before it shows an ad';
    END IF;
    IF jsonb_typeof(fv) <> 'number' OR (fv#>>'{}')::numeric <> trunc((fv#>>'{}')::numeric)
      OR (fv#>>'{}')::numeric < (s->f->>0)::numeric OR (fv#>>'{}')::numeric > (s->f->>1)::numeric THEN
     RAISE EXCEPTION 'Surface % field % is out of range', sn, f;
    END IF;
   ELSE RAISE EXCEPTION 'Surface % has unknown field %', sn, f;
   END IF;
  END LOOP;
  IF COALESCE((sv->>'gap_min')::int,15) > COALESCE((sv->>'gap_max')::int,20) THEN RAISE EXCEPTION 'Surface % gap_min is above gap_max', sn; END IF;
  IF COALESCE((sv->>'first_min')::int,5) > COALESCE((sv->>'first_max')::int,8) THEN RAISE EXCEPTION 'Surface % first_min is above first_max', sn; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.waves_validate_placements(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_validate_placements(jsonb) TO service_role;

-- Bodies below are prod's pg_get_functiondef plus the new lines.
CREATE OR REPLACE FUNCTION public.waves_admin_save_ad_settings(p_settings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF p_settings ? 'placements' THEN PERFORM public.waves_validate_placements(p_settings->'placements'); END IF;
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
 interstitial_video_enabled=COALESCE((p_settings->>'interstitial_video_enabled')::boolean,interstitial_video_enabled),
 placements=COALESCE(p_settings->'placements',placements) WHERE id;
END $function$
;
REVOKE ALL ON FUNCTION public.waves_admin_save_ad_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_save_ad_settings(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.waves_my_ad_gate_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_passive integer;
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
  SELECT count(*) INTO v_passive FROM public.ad_events WHERE profile_id = v_profile AND outcome = 'shown'
    AND placement IN ('native_list','review_banner','home_banner','activity_banner','voice_banner','settings_banner')
    AND created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  RETURN jsonb_build_object('passiveToday',v_passive,'enabled',v_enabled AND COALESCE(v_free,false),
    'bannerEligible',COALESCE(v_enabled AND v_free AND (v_created <= now() - make_interval(days => v_set.banner_min_account_age_days)
      OR EXISTS (SELECT 1 FROM public.ads_allowlist WHERE profile_id = v_profile)), false),
    'credits',public.waves_credit_balance(v_profile),'walletCap',v_set.wallet_cap,
    'perAd',v_set.credits_per_ad,'costs',jsonb_build_object('voice',v_set.voice_cost,'scan',v_set.scan_cost,'export',v_set.export_cost,'group',v_set.group_cost),
    'createdAt',v_created,'settings',to_jsonb(v_set), 'interstitialToday',v_count,
    'lastAdAt',v_last,'lastRewardedAt',v_rewarded,'lastInterstitialAt',v_interstitial,
    'createdGroups',(SELECT count(*) FROM public.groups WHERE created_by = v_profile));
END $function$
;
REVOKE ALL ON FUNCTION public.waves_my_ad_gate_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_my_ad_gate_status() TO authenticated;

DROP FUNCTION IF EXISTS public.waves_admin_ad_events(integer);
CREATE OR REPLACE FUNCTION public.waves_admin_ad_events(p_days integer DEFAULT 30)
 RETURNS TABLE(day date, placement text, shown bigint, completed bigint, skipped bigint, failed bigint, blocked_grace bigint, offline_allowed bigint, owed_offered bigint, owed_declined bigint, blocked_adblock bigint, credit_used bigint, credit_earned bigint, offline_capped bigint, clicked bigint, paid bigint, paid_micros bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT (created_at AT TIME ZONE 'UTC')::date, placement,
 count(*) FILTER (WHERE outcome='shown'), count(*) FILTER (WHERE outcome='completed'),
 count(*) FILTER (WHERE outcome='skipped'), count(*) FILTER (WHERE outcome='failed'),
 count(*) FILTER (WHERE outcome='blocked_grace'),
 count(*) FILTER (WHERE outcome='offline_allowed'), count(*) FILTER (WHERE outcome='owed_offered'),
 count(*) FILTER (WHERE outcome='owed_declined'), count(*) FILTER (WHERE outcome='blocked_adblock'),
 count(*) FILTER (WHERE outcome='credit_used'), count(*) FILTER (WHERE outcome='credit_earned'),
 count(*) FILTER (WHERE outcome='offline_capped'),
 count(*) FILTER (WHERE outcome='clicked'), count(*) FILTER (WHERE outcome='paid'),
 COALESCE(sum(NULLIF(substring(detail from 'micros=([0-9]+)'),'')::bigint) FILTER (WHERE outcome='paid'),0)::bigint
 FROM public.ad_events WHERE created_at >= now() - make_interval(days => LEAST(GREATEST(p_days,1),365))
 GROUP BY 1,2 ORDER BY 1 DESC,2;
$function$
;
REVOKE ALL ON FUNCTION public.waves_admin_ad_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_ad_events(integer) TO service_role;
