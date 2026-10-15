-- Referral "new user" window: judge the referee by when their account became a
-- real (non-guest) account, not by when the profile row was created.
--
-- Every install starts as an anonymous guest and the profile is created at guest
-- start, so profiles.created_at made a friend who browsed for an hour before
-- signing up (or who pasted a code an hour after signing up) look "not new".
-- Now: a claim is accepted if the account joined within the last 7 days, and
-- qualification rejects NOT_NEW_USER only if it joined more than 7 days before
-- the claim. A still-anonymous guest is unchanged (waves_claim_referral answers
-- ACCOUNT_REQUIRED before reaching here).

-- When did this profile become a real account? The earliest of the confirmed
-- phone, the confirmed email and a non-anonymous auth identity; profiles.created_at
-- when none of those exist (guests, and databases without auth).
CREATE OR REPLACE FUNCTION public.waves_referral_joined_at(p_profile uuid) RETURNS timestamptz
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row    jsonb;
  v_ident  timestamptz;
  v_joined timestamptz;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'SELECT to_jsonb(u) FROM auth.users u WHERE u.id = $1' INTO v_row USING p_profile;
  END IF;

  IF to_regclass('auth.identities') IS NOT NULL THEN
    EXECUTE 'SELECT min(i.created_at) FROM auth.identities i WHERE i.user_id = $1 AND i.provider <> ''anonymous'''
       INTO v_ident USING p_profile;
  END IF;

  SELECT min(t) INTO v_joined FROM (VALUES
    ((v_row ->> 'phone_confirmed_at')::timestamptz),
    ((v_row ->> 'email_confirmed_at')::timestamptz),
    (v_ident)
  ) AS x(t);

  IF v_joined IS NULL THEN
    SELECT created_at INTO v_joined FROM public.profiles WHERE id = p_profile;
  END IF;

  RETURN v_joined;
END
$$;

REVOKE ALL ON FUNCTION public.waves_referral_joined_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_joined_at(uuid) TO service_role;


-- Records a claim of `p_referrer` by `p_referee`, enforcing the rules that can be
-- checked at claim time. Shared by waves_claim_referral (a link / code) and the
-- group-invite join. Never raises for a rule refusal; answers { ok, reason }.
CREATE OR REPLACE FUNCTION public.waves_referral_register(p_referee uuid, p_referrer uuid, p_source text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_created timestamptz;
  v_code    text;
  v_id      uuid;
BEGIN
  IF p_referee IS NULL OR p_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'UNKNOWN_CODE');
  END IF;
  IF p_referee = p_referrer THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SELF_REFERRAL');
  END IF;

  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_referee;
  IF v_created IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_PROFILE');
  END IF;

  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_id = p_referee) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  END IF;

  -- New people only: the account became a real (non-guest) account within the
  -- last 7 days. A guest's profile is created at install, so this is the
  -- verification time, not profiles.created_at.
  v_created := public.waves_referral_joined_at(p_referee);
  IF v_created < now() - interval '7 days' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_NEW_USER');
  END IF;

  v_code := public.waves_referral_code_for(p_referrer);

  INSERT INTO public.referrals (referrer_id, referee_id, code, source)
  VALUES (p_referrer, p_referee, v_code, p_source)
  ON CONFLICT (referee_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'referral_id', v_id);
END
$$;

-- Decides whether a friend's pending referral now qualifies and, if so, rewards
-- both sides. Cheap when there is nothing pending (one unique-index probe).
CREATE OR REPLACE FUNCTION public.waves_referral_try_qualify(p_referee uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  r          public.referrals%ROWTYPE;
  v_ident    jsonb;
  v_keys     text[];
  v_ref_keys text[];
  v_created  timestamptz;
  v_earned_a int;
  v_earned_b int;
  v_days_a   int;
  v_days_b   int;
BEGIN
  IF p_referee IS NULL THEN RETURN jsonb_build_object('rewarded', false, 'reason', 'NONE'); END IF;

  SELECT * INTO r FROM public.referrals
   WHERE referee_id = p_referee AND status = 'claimed'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('rewarded', false, 'reason', 'NONE'); END IF;

  -- 1. A verified account.
  v_ident := public.waves_referral_identity(p_referee);
  IF NOT COALESCE((v_ident ->> 'verified')::boolean, false) THEN
    RETURN jsonb_build_object('rewarded', false, 'reason', 'NOT_VERIFIED');
  END IF;
  SELECT COALESCE(array_agg(k), '{}') INTO v_keys FROM jsonb_array_elements_text(v_ident -> 'keys') k;

  -- 2. A new account (re-checked here: defence in depth for any other writer):
  -- it became a real account no more than 7 days before the claim.
  v_created := public.waves_referral_joined_at(p_referee);
  IF v_created IS NULL OR v_created < r.claimed_at - interval '7 days' THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'NOT_NEW_USER', identity_keys = v_keys WHERE id = r.id;
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

  -- 4. One reward per phone / identity: not the referrer's, not an earlier friend's.
  SELECT COALESCE(array_agg(k), '{}') INTO v_ref_keys
    FROM jsonb_array_elements_text(public.waves_referral_identity(r.referrer_id) -> 'keys') k;

  IF v_keys && v_ref_keys THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'SAME_IDENTITY', identity_keys = v_keys WHERE id = r.id;
    RETURN jsonb_build_object('rewarded', false, 'reason', 'SAME_IDENTITY');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referrals o
     WHERE o.id <> r.id AND o.status = 'rewarded' AND o.identity_keys && v_keys
  ) THEN
    UPDATE public.referrals SET status = 'rejected', reject_reason = 'IDENTITY_REUSED', identity_keys = v_keys WHERE id = r.id;
    RETURN jsonb_build_object('rewarded', false, 'reason', 'IDENTITY_REUSED');
  END IF;

  -- 5. Reward both. Serialise per account (in a fixed order) so two rewards
  -- landing together cannot both read the same "earned so far" and bust the cap.
  PERFORM pg_advisory_xact_lock(hashtextextended('referral:' || LEAST(r.referrer_id, r.referee_id)::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('referral:' || GREATEST(r.referrer_id, r.referee_id)::text, 0));

  v_earned_a := public.waves_referral_days_earned(r.referrer_id);
  v_earned_b := public.waves_referral_days_earned(p_referee);
  v_days_a := GREATEST(0, LEAST(7, 30 - v_earned_a));
  v_days_b := GREATEST(0, LEAST(7, 30 - v_earned_b));

  PERFORM public.waves_referral_grant(r.referrer_id, v_days_a, 'referral:' || r.id::text || ':referrer');
  PERFORM public.waves_referral_grant(p_referee,     v_days_b, 'referral:' || r.id::text || ':referee');

  UPDATE public.referrals
     SET status = 'rewarded', qualified_at = now(), referrer_days = v_days_a,
         referee_days = v_days_b, identity_keys = v_keys
   WHERE id = r.id;

  RETURN jsonb_build_object('rewarded', true, 'referrer_days', v_days_a, 'referee_days', v_days_b);
END
$$;

