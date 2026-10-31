-- What: a qualified referral now pays 50 credits to each side (the non-expiring wallet), not
--   7 days of Pro. Qualification rules (new-user window, first expense in a group of 2+,
--   identity/device checks) are unchanged; only step 6 of waves_referral_try_qualify changed.
-- Caps: a referrer is paid for at most 10 rewarded referrals (500 credits); a friend is paid
--   once per account (IDENTITY_REUSED already refuses a second reward on one identity).
-- Idempotency: ledger ref 'referral:<referral id>:<role>' is unique, so a replay never pays twice.
-- Old days columns and rows stay as history; nothing new is granted as Pro days.

ALTER TABLE public.referrals
  ADD COLUMN referrer_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN referee_credits  integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT referrals_credits_sane CHECK (referrer_credits BETWEEN 0 AND 50 AND referee_credits BETWEEN 0 AND 50);

ALTER TABLE public.credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_reason_check CHECK (reason IN
  ('ad_gate','ad_voice','ad_voluntary','ad_offer','spend_voice','spend_scan','spend_export','spend_group','referral'));

-- Credits earned by the person, or by any earlier account with the same identity.
CREATE OR REPLACE FUNCTION public.waves_referral_credits_earned(p_profile uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_keys text[] := public.waves_identity_lookup_keys(p_profile);
BEGIN
  RETURN (
    COALESCE((SELECT sum(referrer_credits) FROM public.referrals
               WHERE referrer_id = p_profile
                  OR (cardinality(v_keys) > 0 AND referrer_keys && v_keys)), 0)
    + COALESCE((SELECT sum(referee_credits) FROM public.referrals
                 WHERE referee_id = p_profile
                    OR (cardinality(v_keys) > 0 AND identity_keys && v_keys)), 0)
  )::int;
END
$$;
REVOKE ALL ON FUNCTION public.waves_referral_credits_earned(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_credits_earned(uuid) TO service_role;

-- waves_referral_try_qualify from 20261022090000_durable_identity_and_usage; only step 6 differs.
CREATE OR REPLACE FUNCTION public.waves_referral_try_qualify(p_referee uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  r          public.referrals%ROWTYPE;
  v_ident    jsonb;
  v_keys     text[];
  v_lookup   text[];
  v_ref_keys text[];
  v_ref_lookup text[];
  v_devs     text[];
  v_ref_devs text[];
  v_created  timestamptz;
  v_key      text;
  v_referrer uuid;
  v_reward   constant integer := 50;
  v_max      constant integer := 10;
  v_done     integer;
  v_cred_a   integer;
  v_cred_b   integer;
  v_rows     integer;
BEGIN
  IF p_referee IS NULL THEN RETURN jsonb_build_object('rewarded', false, 'reason', 'NONE'); END IF;

  SELECT referrer_id INTO v_referrer FROM public.referrals
   WHERE referee_id = p_referee AND status = 'claimed';
  IF NOT FOUND OR v_referrer IS NULL THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'NONE');
  END IF;
  PERFORM public.waves_profile_lock(LEAST(v_referrer, p_referee));
  PERFORM public.waves_profile_lock(GREATEST(v_referrer, p_referee));

  SELECT * INTO r FROM public.referrals
   WHERE referee_id = p_referee AND status = 'claimed'
   FOR UPDATE;
  IF NOT FOUND OR r.referrer_id IS NULL OR r.referrer_id <> v_referrer THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'NONE');
  END IF;

  -- 1. A verified account.
  v_ident := public.waves_referral_identity(p_referee);
  IF NOT COALESCE((v_ident ->> 'verified')::boolean, false) THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'NOT_VERIFIED');
  END IF;
  v_keys := public.waves_identity_keys(p_referee);
  v_lookup := public.waves_identity_lookup_keys(p_referee);
  v_devs := public.waves_device_keys(p_referee);
  v_ref_keys := public.waves_identity_keys(r.referrer_id);
  v_ref_lookup := public.waves_identity_lookup_keys(r.referrer_id);
  v_ref_devs := public.waves_device_keys(r.referrer_id);

  -- 2. A new account: real no more than 7 days before the claim.
  v_created := public.waves_referral_joined_at(p_referee);
  IF v_created IS NULL OR v_created < r.claimed_at - interval '7 days' THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'NOT_NEW_USER',
           identity_keys = v_keys, referrer_keys = v_ref_keys, device_keys = v_devs, referrer_device_keys = v_ref_devs
     WHERE id = r.id;
    RETURN jsonb_build_object('rewarded', false, 'reason', 'NOT_NEW_USER');
  END IF;

  -- 3. A genuine expense: not deleted, created by them, in a group of 2+ people.
  IF NOT EXISTS (
    SELECT 1
      FROM public.expenses e
      JOIN public.group_members cm ON cm.id = e.created_by AND cm.profile_id = p_referee
     WHERE e.deleted_at IS NULL
       AND (SELECT count(*) FROM public.group_members gm
             WHERE gm.group_id = e.group_id AND gm.left_at IS NULL) >= 2
  ) THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'NOT_YET');
  END IF;

  -- 4. Locks: every identity key of both sides (sorted).
  FOR v_key IN
    SELECT DISTINCT k FROM unnest(v_lookup || v_ref_lookup) k ORDER BY k
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('referral_key:' || v_key, 0));
  END LOOP;

  -- 5. One reward per identity.
  IF v_lookup && v_ref_lookup THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'SAME_IDENTITY',
           identity_keys = v_keys, referrer_keys = v_ref_keys, device_keys = v_devs, referrer_device_keys = v_ref_devs
     WHERE id = r.id;
    RETURN jsonb_build_object('rewarded', false, 'reason', 'SAME_IDENTITY');
  END IF;
  IF cardinality(v_devs) > 0 AND v_devs && v_ref_devs THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'SAME_DEVICE',
           identity_keys = v_keys, referrer_keys = v_ref_keys, device_keys = v_devs, referrer_device_keys = v_ref_devs
     WHERE id = r.id;
    RETURN jsonb_build_object('rewarded', false, 'reason', 'SAME_DEVICE');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referrals o
     WHERE o.id <> r.id AND o.status = 'rewarded' AND o.identity_keys && v_lookup
  ) THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'IDENTITY_REUSED',
           identity_keys = v_keys, referrer_keys = v_ref_keys, device_keys = v_devs, referrer_device_keys = v_ref_devs
     WHERE id = r.id;
    RETURN jsonb_build_object('rewarded', false, 'reason', 'IDENTITY_REUSED');
  END IF;

  -- 6. Pay both in credits, under the locks above. The referrer is paid for at most
  --    v_max rewarded referrals (counted by account or identity, legacy day-rewards included).
  SELECT count(*) INTO v_done FROM public.referrals o
   WHERE o.id <> r.id AND o.status = 'rewarded'
     AND (o.referrer_id = r.referrer_id
          OR (cardinality(v_ref_lookup) > 0 AND o.referrer_keys && v_ref_lookup));
  v_cred_a := CASE WHEN v_done >= v_max THEN 0 ELSE v_reward END;
  v_cred_b := v_reward;

  IF v_cred_a > 0 THEN
    INSERT INTO public.credit_ledger(profile_id, delta, reason, ref)
    VALUES (r.referrer_id, v_cred_a, 'referral', 'referral:' || r.id::text || ':referrer')
    ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_cred_a := 0; END IF;
  END IF;
  INSERT INTO public.credit_ledger(profile_id, delta, reason, ref)
  VALUES (p_referee, v_cred_b, 'referral', 'referral:' || r.id::text || ':referee')
  ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN v_cred_b := 0; END IF;

  UPDATE public.referrals
     SET status = 'rewarded', qualified_at = now(), referrer_credits = v_cred_a,
         referee_credits = v_cred_b, identity_keys = v_keys, referrer_keys = v_ref_keys,
         device_keys = v_devs, referrer_device_keys = v_ref_devs
   WHERE id = r.id;

  RETURN jsonb_build_object('rewarded', true, 'referrer_credits', v_cred_a, 'referee_credits', v_cred_b);
END
$$;
REVOKE ALL ON FUNCTION public.waves_referral_try_qualify(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_try_qualify(uuid) TO service_role;

-- waves_my_referral from 20261015140000_referral_rewards: adds credits_earned / friends_cap /
-- credit_reward. days_* stay (zero for new rewards) so an older app build still parses it.
CREATE OR REPLACE FUNCTION public.waves_my_referral() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_earned  int;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  IF public.waves_is_guest(v_profile) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  v_earned := public.waves_referral_days_earned(v_profile);

  RETURN jsonb_build_object(
    'ok', true,
    'code', public.waves_referral_code_for(v_profile),
    'invited',  (SELECT count(*) FROM public.referrals WHERE referrer_id = v_profile),
    'pending',  (SELECT count(*) FROM public.referrals WHERE referrer_id = v_profile AND status = 'claimed'),
    'rewarded', (SELECT count(*) FROM public.referrals WHERE referrer_id = v_profile AND status = 'rewarded'),
    'days_earned', v_earned,
    'days_cap', 30,
    'days_remaining', GREATEST(0, 30 - v_earned),
    'credits_earned', public.waves_referral_credits_earned(v_profile),
    'credit_reward', 50,
    'friends_cap', 10
  );
END
$$;
REVOKE ALL ON FUNCTION public.waves_my_referral() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_referral() TO authenticated, service_role;

-- The admin list gains the credits paid (0 for the referrer past the 10 friend cap).
DROP FUNCTION public.waves_admin_referrals(integer);
CREATE FUNCTION public.waves_admin_referrals(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, referrer_id uuid, referrer_name text, referee_id uuid, referee_name text,
              source text, status text, reject_reason text, claimed_at timestamp with time zone,
              qualified_at timestamp with time zone, referrer_days integer, referee_days integer,
              referrer_credits integer, referee_credits integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT r.id, r.referrer_id, COALESCE(a.display_name, '(deleted)'), r.referee_id,
         COALESCE(b.display_name, '(deleted)'),
         r.source, r.status, r.reject_reason, r.claimed_at, r.qualified_at,
         r.referrer_days, r.referee_days, r.referrer_credits, r.referee_credits
    FROM public.referrals r
    LEFT JOIN public.profiles a ON a.id = r.referrer_id
    LEFT JOIN public.profiles b ON b.id = r.referee_id
   ORDER BY r.claimed_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;
REVOKE ALL ON FUNCTION public.waves_admin_referrals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_referrals(integer) TO service_role;
