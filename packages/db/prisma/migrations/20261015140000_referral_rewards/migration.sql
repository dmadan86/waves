-- Referral rewards: "Invite your friends".
--
-- A person shares a personal link (https://wavs.co.in/r/<CODE>). When the friend
-- registers with a verified account, claims the code, and then records a real
-- expense in a group of at least two people, BOTH get 7 days of Plus. Nothing is
-- ever granted for an install, a rating or a review (Google Play's incentivised
-- install policy): the only trigger is genuine use of the product.
--
-- How the days are granted. This reuses the promo mechanism: a `subscriptions`
-- row with store 'promo', tier 'plus', so waves_my_plan / waves_profile_is_paid /
-- the app's entitlement logic show the days with no changes. Unlike
-- waves_grant_promo (which starts at now()), a referral grant STARTS WHERE THE
-- CURRENT COVERAGE ENDS: base = the latest end date among the account's active
-- non-lifetime Plus/Pro rows (an earlier promo, or a paid Play / App Store
-- subscription), or now() when there is none. So referral days extend an
-- existing promo and sit after a paid store subscription instead of overlapping
-- it and being wasted. A lifetime row has no end date and is ignored for the
-- base (the days are harmless there). The row's store_txn_id is
-- 'referral:<referral id>:<role>', so a replay can never grant twice.
--
-- Each account may earn at most 30 referral days in total, as referrer and as
-- friend together: a reward is min(7, 30 - already earned), and nothing at 0.
--
-- Anti-abuse: no self-referral; one referral per friend, ever; the friend's
-- profile must be created at most 1 hour before the claim (claim-after-signup);
-- the friend must be verified (a confirmed phone or confirmed email / OAuth
-- identity in auth.users); the friend's verified phone / email must not match
-- the referrer's or any already-rewarded friend's.

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE public.referral_codes (
    id         uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    code       text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT referral_codes_pkey PRIMARY KEY (id),
    CONSTRAINT referral_codes_profile_key UNIQUE (profile_id),
    CONSTRAINT referral_codes_code_key UNIQUE (code),
    -- No 0/O/1/I/L: the code is read aloud and typed from screenshots.
    CONSTRAINT referral_codes_shape CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
    CONSTRAINT referral_codes_profile_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE public.referrals (
    id            uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id   uuid NOT NULL,
    referee_id    uuid NOT NULL,
    code          text NOT NULL,
    -- 'code' (a link / typed code) or 'group_invite' (joined through a group invite link).
    source        text DEFAULT 'code' NOT NULL,
    status        text DEFAULT 'claimed' NOT NULL,
    reject_reason text,
    claimed_at    timestamp with time zone DEFAULT now() NOT NULL,
    qualified_at  timestamp with time zone,
    referrer_days integer DEFAULT 0 NOT NULL,
    referee_days  integer DEFAULT 0 NOT NULL,
    -- 'phone:<digits>' / 'email:<lowercase>' of the friend's verified identities,
    -- stamped when the friend is evaluated; the one-reward-per-identity check.
    identity_keys text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT referrals_pkey PRIMARY KEY (id),
    CONSTRAINT referrals_referee_key UNIQUE (referee_id),
    CONSTRAINT referrals_status_known CHECK (status = ANY (ARRAY['claimed'::text, 'rewarded'::text, 'rejected'::text])),
    CONSTRAINT referrals_source_known CHECK (source = ANY (ARRAY['code'::text, 'group_invite'::text])),
    CONSTRAINT referrals_days_sane CHECK (referrer_days BETWEEN 0 AND 7 AND referee_days BETWEEN 0 AND 7),
    CONSTRAINT referrals_not_self CHECK (referrer_id <> referee_id),
    CONSTRAINT referrals_referrer_fkey FOREIGN KEY (referrer_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT referrals_referee_fkey FOREIGN KEY (referee_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT referrals_code_fkey FOREIGN KEY (code)
      REFERENCES public.referral_codes(code) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX referrals_referrer_idx ON public.referrals USING btree (referrer_id, status);
CREATE INDEX referrals_identity_idx ON public.referrals USING gin (identity_keys);

-- 2. RLS: a person reads only their own rows; every write goes through the RPCs.

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_codes_select_own ON public.referral_codes FOR SELECT TO authenticated
  USING (profile_id = public.waves_current_profile_id());
CREATE POLICY referrals_select_own ON public.referrals FOR SELECT TO authenticated
  USING (referrer_id = public.waves_current_profile_id() OR referee_id = public.waves_current_profile_id());

REVOKE ALL ON TABLE public.referral_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.referrals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.referral_codes TO authenticated;
GRANT SELECT ON TABLE public.referrals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.referral_codes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.referrals TO service_role;

-- 3. Internals ---------------------------------------------------------------

-- Is this account verified, and by which phone / email? Verified means a real
-- (non-anonymous) account with a confirmed phone or a confirmed email, which is
-- also what an OAuth sign-in records. Read through to_jsonb so a database whose
-- auth.users lacks a column (the bare test schema) just reads as not verified.
CREATE OR REPLACE FUNCTION public.waves_referral_identity(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row   jsonb;
  v_keys  text[] := '{}';
  v_phone text;
  v_email text;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN jsonb_build_object('verified', false, 'keys', '[]'::jsonb);
  END IF;

  EXECUTE 'SELECT to_jsonb(u) FROM auth.users u WHERE u.id = $1' INTO v_row USING p_profile;
  IF v_row IS NULL OR COALESCE((v_row ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('verified', false, 'keys', '[]'::jsonb);
  END IF;

  IF v_row ->> 'phone_confirmed_at' IS NOT NULL THEN
    v_phone := nullif(regexp_replace(COALESCE(v_row ->> 'phone', ''), '[^0-9]', '', 'g'), '');
    IF v_phone IS NOT NULL THEN v_keys := v_keys || ('phone:' || v_phone); END IF;
  END IF;
  IF v_row ->> 'email_confirmed_at' IS NOT NULL THEN
    v_email := nullif(lower(btrim(COALESCE(v_row ->> 'email', ''))), '');
    IF v_email IS NOT NULL THEN v_keys := v_keys || ('email:' || v_email); END IF;
  END IF;

  RETURN jsonb_build_object('verified', cardinality(v_keys) > 0, 'keys', to_jsonb(v_keys));
END
$$;

-- Returns the profile's code, creating it on first use.
CREATE OR REPLACE FUNCTION public.waves_referral_code_for(p_profile uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_code     text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes    bytea;
  v_try      int := 0;
BEGIN
  SELECT code INTO v_code FROM public.referral_codes WHERE profile_id = p_profile;
  IF v_code IS NOT NULL THEN RETURN v_code; END IF;

  LOOP
    v_try := v_try + 1;
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    FOR i IN 0..7 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 31) + 1, 1);
    END LOOP;

    BEGIN
      INSERT INTO public.referral_codes (profile_id, code) VALUES (p_profile, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Either the same person raced us (then theirs is the code) or a code
      -- collided (then try another).
      SELECT code INTO v_code FROM public.referral_codes WHERE profile_id = p_profile;
      IF v_code IS NOT NULL THEN RETURN v_code; END IF;
      IF v_try >= 8 THEN RAISE; END IF;
    END;
  END LOOP;
END
$$;

-- Referral days a profile has earned so far, as referrer and as friend.
CREATE OR REPLACE FUNCTION public.waves_referral_days_earned(p_profile uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT (
    COALESCE((SELECT sum(referrer_days) FROM public.referrals WHERE referrer_id = p_profile), 0)
    + COALESCE((SELECT sum(referee_days) FROM public.referrals WHERE referee_id = p_profile), 0)
  )::int
$$;

-- Grants `p_days` of Plus as a promo row that starts where current coverage ends.
CREATE OR REPLACE FUNCTION public.waves_referral_grant(p_profile uuid, p_days integer, p_source text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_base timestamptz;
  v_id   uuid;
BEGIN
  IF p_days IS NULL OR p_days <= 0 THEN RETURN NULL; END IF;

  SELECT GREATEST(now(), COALESCE(max(current_period_end), now())) INTO v_base
    FROM public.subscriptions
   WHERE profile_id = p_profile
     AND tier IN ('plus', 'pro')
     AND status IN ('active', 'grace')
     AND current_period_end IS NOT NULL;

  INSERT INTO public.subscriptions
    (profile_id, tier, period, status, current_period_end, store, store_txn_id)
  VALUES (p_profile, 'plus', 'monthly', 'active', v_base + make_interval(days => p_days), 'promo', p_source)
  ON CONFLICT (store_txn_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

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

  -- New people only: the profile may be at most an hour older than the claim
  -- (sign up, then open the link).
  IF v_created < now() - interval '1 hour' THEN
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
-- Idempotent: the row is locked and flipped from 'claimed' exactly once.
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

  -- 2. A new profile (re-checked here: defence in depth for any other writer).
  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_referee;
  IF v_created IS NULL OR v_created < r.claimed_at - interval '1 hour' THEN
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

-- 4. Triggers: qualification must never break the write that fired it ---------

CREATE OR REPLACE FUNCTION public.waves_referral_after_expense() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid;
BEGIN
  BEGIN
    IF NEW.created_by IS NOT NULL AND NEW.deleted_at IS NULL THEN
      SELECT profile_id INTO v_profile FROM public.group_members WHERE id = NEW.created_by;
      IF v_profile IS NOT NULL THEN
        PERFORM public.waves_referral_try_qualify(v_profile);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral qualification failed for expense %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

-- The expense may have come first and the second member arrives later.
CREATE OR REPLACE FUNCTION public.waves_referral_after_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid;
BEGIN
  BEGIN
    FOR v_profile IN
      SELECT gm.profile_id
        FROM public.group_members gm
        JOIN public.referrals rf ON rf.referee_id = gm.profile_id AND rf.status = 'claimed'
       WHERE gm.group_id = NEW.group_id AND gm.left_at IS NULL AND gm.profile_id IS NOT NULL
    LOOP
      PERFORM public.waves_referral_try_qualify(v_profile);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral qualification failed for group %: %', NEW.group_id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

CREATE TRIGGER expenses_referral_qualify AFTER INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.waves_referral_after_expense();

CREATE TRIGGER group_members_referral_qualify AFTER INSERT OR UPDATE OF left_at ON public.group_members
  FOR EACH ROW WHEN (NEW.profile_id IS NOT NULL AND NEW.left_at IS NULL)
  EXECUTE FUNCTION public.waves_referral_after_member();

-- 5. Client RPCs ---------------------------------------------------------------

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
    'days_remaining', GREATEST(0, 30 - v_earned)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.waves_claim_referral(p_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile  uuid := public.waves_current_profile_id();
  v_referrer uuid;
  v_result   jsonb;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  IF public.waves_is_guest(v_profile) THEN
    -- Not definitive: the same person may sign up properly and try again.
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT profile_id INTO v_referrer FROM public.referral_codes
   WHERE code = upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'UNKNOWN_CODE');
  END IF;

  v_result := public.waves_referral_register(v_profile, v_referrer, 'code');

  -- They may already have used Waves for real (signed up, did things, then opened
  -- the link within the hour); evaluate now rather than waiting for the next write.
  IF (v_result ->> 'ok')::boolean THEN
    BEGIN
      PERFORM public.waves_referral_try_qualify(v_profile);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'referral qualification failed for %: %', v_profile, SQLERRM;
    END;
  END IF;

  RETURN v_result;
END
$$;

-- 6. Group invite = referral claim by the inviter -------------------------------
-- invites.created_by is the inviting profile, so accepting a group invite counts
-- as a claim of that inviter when the joiner is new and has no referral yet. The
-- hook only ever adds a row; any refusal or error is swallowed, so joining a
-- group behaves exactly as before. Otherwise identical to
-- 20261012160000_removed_member_needs_new_invite.
CREATE OR REPLACE FUNCTION public.waves_join_via_invite(p_invite_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_created_at timestamptz;
  v_inviter    uuid;
  v_member_id  uuid;
  v_left_at    timestamptz;
  v_removed_at timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  IF public.waves_is_guest(p_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT group_id, created_at, created_by INTO v_group_id, v_created_at, v_inviter
    FROM public.invites WHERE id = p_invite_id;
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  SELECT id, left_at, removed_at INTO v_member_id, v_left_at, v_removed_at
    FROM public.group_members
   WHERE group_id = v_group_id AND profile_id = p_profile_id
   FOR UPDATE;

  IF v_member_id IS NOT NULL AND v_left_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id, 'already_member', true);
  END IF;

  IF v_removed_at IS NOT NULL AND v_created_at <= v_removed_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REMOVED');
  END IF;

  IF public.waves_consume_invite(p_invite_id) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.group_members
       SET left_at = NULL, removed_at = NULL, removed_by = NULL,
           role = 'member', joined_via = 'invite_link'
     WHERE id = v_member_id;
  ELSE
    INSERT INTO public.group_members (group_id, profile_id, joined_via)
    VALUES (v_group_id, p_profile_id, 'invite_link')
    RETURNING id INTO v_member_id;
  END IF;

  IF v_inviter IS NOT NULL THEN
    BEGIN
      PERFORM public.waves_referral_register(p_profile_id, v_inviter, 'group_invite');
      PERFORM public.waves_referral_try_qualify(p_profile_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'group-invite referral failed for %: %', p_profile_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id);
END
$$;

-- 7. Grants ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.waves_referral_identity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_code_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_days_earned(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_grant(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_register(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_try_qualify(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_after_expense() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waves_referral_after_member() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_identity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_referral_code_for(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_referral_days_earned(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_referral_grant(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_referral_register(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.waves_referral_try_qualify(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.waves_my_referral() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.waves_claim_referral(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_referral() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.waves_claim_referral(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.waves_join_via_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_join_via_invite(uuid, uuid) TO service_role;

-- 8. Admin: who referred whom ---------------------------------------------------
-- Read by the admin app (service role) on the Promotions page.

CREATE OR REPLACE FUNCTION public.waves_admin_referrals(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, referrer_id uuid, referrer_name text, referee_id uuid, referee_name text,
              source text, status text, reject_reason text, claimed_at timestamp with time zone,
              qualified_at timestamp with time zone, referrer_days integer, referee_days integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT r.id, r.referrer_id, a.display_name, r.referee_id, b.display_name,
         r.source, r.status, r.reject_reason, r.claimed_at, r.qualified_at,
         r.referrer_days, r.referee_days
    FROM public.referrals r
    JOIN public.profiles a ON a.id = r.referrer_id
    JOIN public.profiles b ON b.id = r.referee_id
   ORDER BY r.claimed_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;

REVOKE ALL ON FUNCTION public.waves_admin_referrals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_referrals(integer) TO service_role;
