-- What: one non-expiring server wallet; scan purchases add a monthly slot (unused slots lapse).
-- Who: clients read/spend only their wallet; verified SSV and admin use service_role.
-- How: reuse usage_guard's profile advisory lock for every wallet mutation (one lock order).
-- Permanent SSV receipts prevent replays, including callbacks originally refused.
CREATE TABLE public.credit_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 delta integer NOT NULL,
 reason text NOT NULL CHECK (reason IN ('ad_gate','ad_voice','ad_voluntary','ad_offer','spend_voice','spend_scan','spend_export','spend_group')),
 ref text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_ledger_ref_unique ON public.credit_ledger(ref) WHERE ref IS NOT NULL;
CREATE INDEX credit_ledger_profile_created_idx ON public.credit_ledger(profile_id,created_at);
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.ad_reward_settings
 ADD COLUMN credits_per_ad integer NOT NULL DEFAULT 6 CHECK (credits_per_ad BETWEEN 1 AND 100),
 ADD COLUMN voice_cost integer NOT NULL DEFAULT 1 CHECK (voice_cost BETWEEN 1 AND 100),
 ADD COLUMN scan_cost integer NOT NULL DEFAULT 2 CHECK (scan_cost BETWEEN 1 AND 100),
 ADD COLUMN export_cost integer NOT NULL DEFAULT 6 CHECK (export_cost BETWEEN 1 AND 100),
 ADD COLUMN group_cost integer NOT NULL DEFAULT 6 CHECK (group_cost BETWEEN 1 AND 100),
 ADD COLUMN wallet_cap integer NOT NULL DEFAULT 30 CHECK (wallet_cap BETWEEN 1 AND 1000),
 ADD COLUMN rewarded_daily_cap integer NOT NULL DEFAULT 5 CHECK (rewarded_daily_cap BETWEEN 0 AND 100),
 ADD COLUMN rewarded_hourly_cap integer NOT NULL DEFAULT 2 CHECK (rewarded_hourly_cap BETWEEN 0 AND 100),
 ADD COLUMN rewarded_gap_seconds integer NOT NULL DEFAULT 60 CHECK (rewarded_gap_seconds BETWEEN 0 AND 86400),
 ADD COLUMN voluntary_daily_cap integer NOT NULL DEFAULT 3 CHECK (voluntary_daily_cap BETWEEN 0 AND 100),
 ADD COLUMN voluntary_weekly_cap integer NOT NULL DEFAULT 10 CHECK (voluntary_weekly_cap BETWEEN 0 AND 700),
 ADD COLUMN interstitial_video_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.ad_rewards DROP CONSTRAINT ad_rewards_kind_known;
ALTER TABLE public.ad_rewards ADD CONSTRAINT ad_rewards_kind_known CHECK (kind IN ('voice','scan','credit'));
ALTER TABLE public.ad_rewards ADD COLUMN source text;
ALTER TABLE public.ad_events DROP CONSTRAINT ad_events_placement_check;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_placement_check CHECK (placement IN
 ('expense_interstitial','group_create_rewarded','export_rewarded','native_list','quota_rewarded','credit_voluntary','credit_offer'));

CREATE OR REPLACE FUNCTION public.waves_credit_balance(p_profile uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT COALESCE(sum(delta),0)::integer FROM public.credit_ledger WHERE profile_id=p_profile;
$$;
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
    'credits',public.waves_credit_balance(v_profile),'walletCap',v_set.wallet_cap,
    'perAd',v_set.credits_per_ad,'costs',jsonb_build_object('voice',v_set.voice_cost,'scan',v_set.scan_cost,'export',v_set.export_cost,'group',v_set.group_cost),
    'createdAt',v_created,'settings',to_jsonb(v_set), 'interstitialToday',v_count,
    'lastAdAt',v_last,'lastRewardedAt',v_rewarded,'lastInterstitialAt',v_interstitial,
    'createdGroups',(SELECT count(*) FROM public.groups WHERE created_by = v_profile));
END $$;

CREATE OR REPLACE FUNCTION public.waves_credit_status(p_profile uuid, p_source text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
 v_profile uuid := p_profile;
 v_set public.ad_reward_settings%ROWTYPE;
 v_created timestamptz; v_enabled boolean; v_free boolean;
 v_balance integer; v_daily integer; v_hourly integer; v_vday integer; v_vweek integer;
 v_last timestamptz; v_hour_first timestamptz; v_reason text; v_next timestamptz;
 v_day timestamptz := date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 v_week timestamptz := date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
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

 v_balance := public.waves_credit_balance(p_profile);
 SELECT count(*) FILTER (WHERE t >= v_day), count(*) FILTER (WHERE t > now()-interval '1 hour'),
 max(t), min(t) FILTER (WHERE t > now()-interval '1 hour')
 INTO v_daily,v_hourly,v_last,v_hour_first
 FROM (
  SELECT created_at AS t FROM public.ad_rewards WHERE profile_id=p_profile
  UNION ALL
  SELECT created_at FROM public.ad_events WHERE profile_id=p_profile AND outcome='completed'
   AND placement IN ('group_create_rewarded','export_rewarded')
 ) rewards;
 SELECT count(*) FILTER (WHERE created_at>=v_day), count(*) FILTER (WHERE created_at>=v_week)
 INTO v_vday,v_vweek FROM public.ad_rewards WHERE profile_id=p_profile AND kind='credit' AND source='voluntary';
 IF NOT COALESCE(v_enabled AND v_free,false) THEN v_reason := 'ineligible';
 ELSIF v_balance>=v_set.wallet_cap THEN v_reason := 'wallet_full';
 ELSIF v_last + make_interval(secs=>v_set.rewarded_gap_seconds)>now() THEN
  v_reason := 'gap'; v_next := v_last + make_interval(secs=>v_set.rewarded_gap_seconds);
 ELSIF v_hourly>=v_set.rewarded_hourly_cap THEN
  v_reason := 'hourly_cap'; v_next := v_hour_first+interval '1 hour';
 ELSIF v_daily>=v_set.rewarded_daily_cap THEN v_reason := 'daily_cap'; v_next := v_day+interval '1 day';
 ELSIF p_source='voluntary' AND v_vday>=v_set.voluntary_daily_cap THEN
  v_reason := 'voluntary_daily'; v_next := v_day+interval '1 day';
 ELSIF p_source='voluntary' AND v_vweek>=v_set.voluntary_weekly_cap THEN
  v_reason := 'voluntary_weekly'; v_next := v_week+interval '1 week';
 END IF;
 RETURN jsonb_build_object('credits',v_balance,'walletCap',v_set.wallet_cap,'perAd',v_set.credits_per_ad,
  'costs',jsonb_build_object('voice',v_set.voice_cost,'scan',v_set.scan_cost,'export',v_set.export_cost,'group',v_set.group_cost),
  'canWatch',v_reason IS NULL,'reason',v_reason,'nextAt',v_next,
  'rewardedToday',v_daily,'rewardedDailyCap',v_set.rewarded_daily_cap,
  'voluntaryToday',v_vday,'voluntaryDailyCap',v_set.voluntary_daily_cap,
  'voluntaryWeek',v_vweek,'voluntaryWeeklyCap',v_set.voluntary_weekly_cap);
END $$;
CREATE OR REPLACE FUNCTION public.waves_my_credits() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT public.waves_credit_status(public.waves_current_profile_id(),'voluntary');
$$;
CREATE OR REPLACE FUNCTION public.waves_spend_credits(p_kind text, p_event_id uuid DEFAULT gen_random_uuid()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
 v_profile uuid := public.waves_current_profile_id();
 v_cost integer; v_balance integer;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('voice','scan','export','group') THEN RAISE EXCEPTION 'Invalid credit kind'; END IF;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
 IF p_event_id IS NULL THEN RAISE EXCEPTION 'Event id required'; END IF;
 IF COALESCE(public.waves_my_plan(v_profile)->>'plan','free') <> 'free'
 OR EXISTS (SELECT 1 FROM public.subscriptions WHERE profile_id=v_profile AND tier IN ('plus','pro')
  AND status IN ('active','grace') AND (current_period_end IS NULL OR current_period_end>now()))
 OR public.waves_pro_trial_active(v_profile) IS NOT NULL OR public.waves_voice_trial_until(v_profile) IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'spent',0,'bypass',true);
 END IF;
 PERFORM public.waves_profile_lock(v_profile);
 IF EXISTS (SELECT 1 FROM public.credit_ledger WHERE ref=p_event_id::text) THEN
  IF NOT EXISTS (SELECT 1 FROM public.credit_ledger WHERE ref=p_event_id::text AND profile_id=v_profile AND reason='spend_'||p_kind) THEN
   RAISE EXCEPTION 'Event id already used';
  END IF;
  RETURN jsonb_build_object('ok',true,'spent',0,'duplicate',true);
 END IF;
 SELECT CASE p_kind WHEN 'voice' THEN voice_cost WHEN 'scan' THEN scan_cost
  WHEN 'export' THEN export_cost WHEN 'group' THEN group_cost END INTO v_cost FROM public.ad_reward_settings WHERE id;
 v_balance := public.waves_credit_balance(v_profile);
 IF v_balance<v_cost THEN RETURN jsonb_build_object('ok',false,'reason','insufficient','credits',v_balance); END IF;
 INSERT INTO public.credit_ledger(profile_id,delta,reason,ref) VALUES(v_profile,-v_cost,'spend_'||p_kind,p_event_id::text);
 RETURN jsonb_build_object('ok',true,'spent',v_cost,'credits',v_balance-v_cost);
END $$;
CREATE OR REPLACE FUNCTION public.waves_ads_grant(
  p_profile uuid,
  p_kind text,
  p_transaction_id text,
  p_ad_unit text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set    public.ad_reward_settings%ROWTYPE;
  v_elig   jsonb;
  v_amount integer;
  v_rows   integer;
  v_outcome text;
  v_credit boolean;
  v_source text;
  v_reason text;
BEGIN
  v_credit := p_kind = 'credit' OR p_kind IN ('credit:voluntary','credit:voice','credit:offer','credit:gate');
  v_source := CASE WHEN p_kind='credit' THEN 'gate' ELSE split_part(p_kind,':',2) END;
  IF p_profile IS NULL OR p_kind IS NULL OR NOT (p_kind IN ('voice','scan') OR v_credit)
     OR COALESCE(btrim(p_transaction_id), '') = '' OR COALESCE(btrim(p_ad_unit), '') = '' THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  PERFORM public.waves_profile_lock(p_profile);
  PERFORM pg_advisory_xact_lock(hashtextextended('ads_grant:' || p_profile::text, 0));

  -- First sight of this transaction id wins; anything after is a replay.
  INSERT INTO public.ad_ssv_transactions (transaction_id, profile_id, kind, ad_unit, outcome)
  VALUES (p_transaction_id, p_profile, p_kind, p_ad_unit, 'pending')
  ON CONFLICT (transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 OR EXISTS (SELECT 1 FROM public.ad_rewards WHERE transaction_id = p_transaction_id) THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    UPDATE public.ad_ssv_transactions SET outcome = 'ineligible:unknown_profile' WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object('outcome', 'ineligible', 'reason', 'unknown_profile');
  END IF;
  IF v_credit THEN
    v_elig := public.waves_credit_status(p_profile,v_source);
    v_reason := v_elig->>'reason';
    IF v_reason IS NOT NULL THEN
      v_outcome := CASE WHEN v_reason='ineligible' THEN 'ineligible' ELSE 'capped' END;
      UPDATE public.ad_ssv_transactions SET outcome=v_outcome||':'||v_reason WHERE transaction_id=p_transaction_id;
      RETURN jsonb_build_object('outcome',v_outcome,'reason',v_reason);
    END IF;
    v_amount := GREATEST(0, LEAST((v_elig->>'perAd')::integer,(v_elig->>'walletCap')::integer-(v_elig->>'credits')::integer));
    INSERT INTO public.ad_rewards(profile_id,kind,source,amount,transaction_id,ad_unit)
      VALUES(p_profile,'credit',v_source,v_amount,p_transaction_id,p_ad_unit);
    INSERT INTO public.credit_ledger(profile_id,delta,reason,ref)
      VALUES(p_profile,v_amount,'ad_'||v_source,p_transaction_id);
    UPDATE public.ad_ssv_transactions SET outcome='granted' WHERE transaction_id=p_transaction_id;
    RETURN jsonb_build_object('outcome','granted','kind','credit','amount',v_amount,'credits',(v_elig->>'credits')::integer+v_amount);
  END IF;
  PERFORM public.waves_usage_guard(p_profile);

  v_elig := public.waves_ads_eligibility(p_profile);
  IF NOT (v_elig ->> 'eligible')::boolean THEN
    v_outcome := CASE WHEN v_elig ->> 'reason' = 'capped' THEN 'capped' ELSE 'ineligible' END;
    UPDATE public.ad_ssv_transactions
       SET outcome = v_outcome || ':' || COALESCE(v_elig ->> 'reason', '')
     WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object('outcome', v_outcome, 'reason', v_elig ->> 'reason');
  END IF;

  SELECT * INTO v_set FROM public.ad_reward_settings WHERE id;
  v_amount := CASE p_kind WHEN 'voice' THEN v_set.voice_per_ad ELSE v_set.scans_per_ad END;
  IF v_amount <= 0 THEN
    UPDATE public.ad_ssv_transactions SET outcome = 'ineligible:disabled' WHERE transaction_id = p_transaction_id;
    RETURN jsonb_build_object('outcome', 'ineligible', 'reason', 'disabled');
  END IF;

  INSERT INTO public.ad_rewards (profile_id, kind, amount, transaction_id, ad_unit)
  VALUES (p_profile, p_kind, v_amount, p_transaction_id, p_ad_unit)
  ON CONFLICT (transaction_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('outcome', 'duplicate');
  END IF;
  UPDATE public.ad_ssv_transactions SET outcome = 'granted' WHERE transaction_id = p_transaction_id;

  RETURN jsonb_build_object(
    'outcome', 'granted',
    'kind', p_kind,
    'amount', v_amount,
    'usedToday', (v_elig ->> 'usedToday')::integer + 1,
    'dailyCap', v_set.daily_cap
  );
END
$$;
CREATE OR REPLACE FUNCTION public.waves_voice_agent_quota(
  p_profile uuid,
  p_free_limit integer DEFAULT 10,
  p_pro_limit integer DEFAULT 100,
  p_plus_limit integer DEFAULT 100,
  p_trial_limit integer DEFAULT 20
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_tier  text;
  v_limit integer;
  v_count integer;
  v_bonus integer := 0;
  v_cost integer;
  v_until timestamptz := public.waves_voice_trial_until(p_profile);
  v_ttier text := CASE WHEN public.waves_pro_trial_active(p_profile) IS NOT NULL THEN 'pro' ELSE 'free' END;
BEGIN
  PERFORM public.waves_usage_guard(p_profile);
  IF v_until IS NOT NULL THEN
    UPDATE public.pro_trials
       SET voice_used = voice_used + 1
     WHERE profile_id = p_profile AND voice_used < p_trial_limit
    RETURNING voice_used INTO v_count;
    IF v_count IS NOT NULL THEN
      RETURN jsonb_build_object('used', v_count, 'limit', p_trial_limit, 'tier', v_ttier, 'trial', true, 'until', v_until, 'allowed', true, 'month', v_month);
    END IF;
    SELECT voice_used INTO v_count FROM public.pro_trials WHERE profile_id = p_profile;
    RETURN jsonb_build_object('used', COALESCE(v_count, 0), 'limit', p_trial_limit, 'tier', v_ttier, 'trial', true, 'until', v_until, 'allowed', false, 'month', v_month);
  END IF;

  SELECT CASE WHEN count(*) = 0 THEN 'free' ELSE 'pro' END
    INTO v_tier
    FROM public.subscriptions s
   WHERE s.profile_id = p_profile
     AND s.status IN ('active', 'grace')
     AND s.store <> 'trial'
     AND (s.current_period_end IS NULL OR s.current_period_end > now())
     AND s.tier IN ('plus', 'pro');
  IF v_tier = 'free' THEN
    v_bonus := public.waves_ads_bonus(p_profile, 'voice');
  END IF;
  v_limit := CASE v_tier WHEN 'pro' THEN p_pro_limit ELSE p_free_limit + v_bonus END;

  INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, updated_at)
  SELECT p_profile, v_month, 1, now()
   WHERE v_limit >= 1
  ON CONFLICT (profile_id, month) DO UPDATE
    SET count = u.count + 1, updated_at = now()
    WHERE u.count < v_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NOT NULL THEN
    RETURN jsonb_build_object('used', v_count, 'limit', v_limit, 'tier', v_tier, 'allowed', true, 'month', v_month);
  END IF;

  IF v_tier='free' THEN
    SELECT voice_cost INTO v_cost FROM public.ad_reward_settings WHERE id;
    IF public.waves_credit_balance(p_profile)>=v_cost THEN
      INSERT INTO public.credit_ledger(profile_id,delta,reason) VALUES(p_profile,-v_cost,'spend_voice');
      INSERT INTO public.voice_agent_usage AS u(profile_id,month,count,updated_at)
       VALUES(p_profile,v_month,1,now())
       ON CONFLICT(profile_id,month) DO UPDATE SET count=u.count+1,updated_at=now()
       RETURNING count INTO v_count;
      RETURN jsonb_build_object('used',v_count,'limit',v_limit,'tier',v_tier,'allowed',true,'month',v_month,'credit',true);
    END IF;
  END IF;
  SELECT count INTO v_count
    FROM public.voice_agent_usage WHERE profile_id = p_profile AND month = v_month;
  RETURN jsonb_build_object(
    'used', COALESCE(v_count, 0), 'limit', v_limit, 'tier', v_tier, 'allowed', false, 'month', v_month
  );
END
$$;
CREATE OR REPLACE FUNCTION public.waves_receipt_scan_quota() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_plan  jsonb := public.waves_my_plan();
  v_used  integer := public.waves_scans_used_this_month();
  v_base  integer := (v_plan ->> 'scanLimit')::integer;
  v_bonus integer := 0;
  v_me    uuid := public.waves_current_profile_id();
BEGIN
  IF v_plan ->> 'tier' = 'free' AND v_me IS NOT NULL THEN
    v_bonus := public.waves_ads_bonus(v_me, 'scan') + (SELECT count(*)::integer FROM public.credit_ledger
      WHERE profile_id=v_me AND reason='spend_scan'
      AND created_at >= (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      AND created_at < ((date_trunc('month',now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'));
  END IF;
  RETURN jsonb_build_object(
    'used', v_used,
    'limit', v_base + v_bonus,
    'remaining', greatest(0, v_base + v_bonus - v_used),
    'tier', v_plan ->> 'tier',
    'bonus', v_bonus
  );
END
$$;
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
CREATE OR REPLACE FUNCTION public.waves_admin_credit_stats(p_days integer DEFAULT 30)
RETURNS TABLE(day date, reason text, events bigint, credits bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT (created_at AT TIME ZONE 'UTC')::date,reason,count(*),sum(abs(delta::bigint))::bigint
 FROM public.credit_ledger WHERE created_at>=now()-make_interval(days=>LEAST(GREATEST(p_days,1),365))
 GROUP BY 1,2 ORDER BY 1 DESC,2;
$$;
REVOKE ALL ON FUNCTION public.waves_credit_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_credit_balance(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_credit_status(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_credit_status(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.waves_my_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_my_credits() TO authenticated;
REVOKE ALL ON FUNCTION public.waves_spend_credits(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_spend_credits(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.waves_my_ad_gate_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_my_ad_gate_status() TO authenticated;
REVOKE ALL ON FUNCTION public.waves_ads_grant(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ads_grant(uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.waves_voice_agent_quota(uuid,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_voice_agent_quota(uuid,integer,integer,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.waves_receipt_scan_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_receipt_scan_quota() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_admin_save_ad_settings(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_save_ad_settings(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.waves_admin_credit_stats(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_credit_stats(integer) TO service_role;
