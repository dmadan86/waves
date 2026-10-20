-- Durable identity: usage, trials and referral rewards survive "delete and sign
-- up again", and "one trial per person" means one per canonical identity.
--
-- Closes (abuse audit, Oct 2026):
--   WAV-01  deleting the profile row (waves_delete_my_account, callable directly)
--           cascaded every meter away; re-create the profile, start again.
--   WAV-04  trial / referral identity keys were the raw lower-cased email, so
--           me+1@gmail.com, m.e@gmail.com and me@googlemail.com were three
--           people; a phone attached after the trial was never recorded.
--   WAV-05  referral rows cascaded with the referee, erasing the referrer's
--           30-day lifetime cap and the referee's identity evidence.
--   WAV-06  profiles.created_at was client-writable and the ad "7 days old"
--           rule read it (L2: it is also the guest-install time, not sign-up).
--
-- Pieces:
--   1. waves_private.identity_salt — the one salt, in a schema no API role can
--      reach (no USAGE for anon / authenticated / service_role, so PostgREST
--      cannot expose it and a public-schema dump does not carry it). Hashing
--      has to happen in the database (the auth triggers run here), so the
--      secret has to be readable from SQL; the Vault extension is not present
--      on a bare Postgres (CI) and its decrypted view is readable by the same
--      roles anyway, so a private schema is the boundary that exists.
--   2. waves_canonical_email — lower-case, '+tag' stripped, Gmail dots removed
--      and googlemail folded to gmail.
--   3. waves_referral_identity — canonical salted keys (`keys`, the only ones
--      ever stored from now on) and the unsalted legacy keys (`legacy_keys`,
--      used only to MATCH rows written before this migration), plus
--      `relay_only` (only Apple Hide-My-Email addresses) and `has_phone`.
--   4. waves_device_keys — salted hashes of the device ids this account has
--      registered (device_sessions): an install signal, never a blocker on its
--      own.
--   5. identity_tombstones / usage_carryover — no FK to profiles. On deletion
--      the month's meters are copied here under the auth user id and the
--      identity keys; a profile inserted later for the same auth user or the
--      same identity restores them (taking the larger of the two). Every
--      reservation runs waves_usage_guard first: under the per-profile lock it
--      restores once per profile and refuses when it cannot (fail closed).
--   6. waves_profile_lock — ONE advisory lock per profile, held by deletion
--      (snapshot through DELETE), restoration and every reservation, so a
--      command cannot slip between the snapshot and the cascade.
--   7. pro_trials gains device_keys; the grant refuses a relay-only email on a
--      device that already had a trial, and records device reuse otherwise.
--      Keys confirmed later (a phone added after the trial) are unioned in.
--   8. referrals keep their rows when either side is deleted (FKs SET NULL),
--      carry the referrer's identity keys and both device keys, and the
--      lifetime cap is summed by identity. Same device = self-referral. The
--      reuse and cap checks run under locks on every participant identity key.
--   9. profiles.created_at is immutable for client roles; ad eligibility ages
--      the account from when it was verified (waves_referral_joined_at).
--  10. Backfill: every existing trial / referral row whose accounts still exist
--      gets canonical keys and device keys (waves_identity_backfill); rows whose
--      auth identity is already gone keep their legacy keys, which the lookups
--      still match.
--
-- Every function here is SECURITY DEFINER and service-role only unless it
-- replaces one that a client already calls (waves_delete_my_account).

-- Every lock this migration needs is short; never queue behind a long one.
SET LOCAL lock_timeout = '10s';

-- 1. The salt, out of the public schema ------------------------------------------

CREATE SCHEMA IF NOT EXISTS waves_private;
REVOKE ALL ON SCHEMA waves_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE waves_private.identity_salt (
    id   boolean DEFAULT true NOT NULL,
    salt text NOT NULL,
    CONSTRAINT identity_salt_pkey PRIMARY KEY (id),
    CONSTRAINT identity_salt_single CHECK (id),
    CONSTRAINT identity_salt_len CHECK (char_length(salt) >= 32)
);
INSERT INTO waves_private.identity_salt (id, salt)
VALUES (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
REVOKE ALL ON TABLE waves_private.identity_salt FROM PUBLIC, anon, authenticated, service_role;

-- 2. Canonical email --------------------------------------------------------------
-- Not SECURITY DEFINER: pure text.
CREATE OR REPLACE FUNCTION public.waves_canonical_email(p_email text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_email  text := lower(btrim(p_email));
  v_local  text;
  v_domain text;
BEGIN
  IF position('@' IN v_email) = 0 THEN RETURN v_email; END IF;
  v_local  := substring(v_email FROM '^(.*)@[^@]*$');
  v_domain := substring(v_email FROM '@([^@]*)$');
  -- Sub-addressing: anything from the first '+' is routed to the same inbox.
  v_local := regexp_replace(v_local, '\+.*$', '');
  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;
  RETURN v_local || '@' || v_domain;
END
$$;

-- 3. Salted hash and the identity -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waves_identity_hash(p_kind text, p_value text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT encode(sha256(convert_to(s.salt || '|' || p_kind || ':' || p_value, 'UTF8')), 'hex')
    FROM waves_private.identity_salt s
   WHERE s.id;
$$;

REVOKE ALL ON FUNCTION public.waves_identity_hash(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_hash(text, text) TO service_role;

-- Which identities a verified account has. `keys` are the canonical salted
-- keys (stored); `legacy_keys` the unsalted ones rows written before this
-- migration carry (phone:<digits>, email:<lowercase>): matched, never stored.
CREATE OR REPLACE FUNCTION public.waves_referral_identity(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row    jsonb;
  v_keys   text[] := '{}';
  v_legacy text[] := '{}';
  v_phone  text;
  v_email  text;
  v_canon  text;
  v_has_phone boolean := false;
  v_relay_only boolean := false;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN jsonb_build_object('verified', false, 'keys', '[]'::jsonb, 'legacy_keys', '[]'::jsonb, 'has_phone', false, 'relay_only', false);
  END IF;

  EXECUTE 'SELECT to_jsonb(u) FROM auth.users u WHERE u.id = $1' INTO v_row USING p_profile;
  IF v_row IS NULL OR COALESCE((v_row ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('verified', false, 'keys', '[]'::jsonb, 'legacy_keys', '[]'::jsonb, 'has_phone', false, 'relay_only', false);
  END IF;

  IF v_row ->> 'phone_confirmed_at' IS NOT NULL THEN
    v_phone := nullif(regexp_replace(COALESCE(v_row ->> 'phone', ''), '[^0-9]', '', 'g'), '');
    IF v_phone IS NOT NULL THEN
      v_has_phone := true;
      v_keys := v_keys || public.waves_identity_hash('phone', v_phone);
      v_legacy := v_legacy || encode(sha256(convert_to('phone:' || v_phone, 'UTF8')), 'hex');
    END IF;
  END IF;
  IF v_row ->> 'email_confirmed_at' IS NOT NULL THEN
    v_email := nullif(lower(btrim(COALESCE(v_row ->> 'email', ''))), '');
    IF v_email IS NOT NULL THEN
      v_canon := public.waves_canonical_email(v_email);
      v_keys := v_keys || public.waves_identity_hash('email', v_canon);
      v_legacy := v_legacy || encode(sha256(convert_to('email:' || v_email, 'UTF8')), 'hex');
      v_relay_only := NOT v_has_phone AND v_canon LIKE '%@privaterelay.appleid.com';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'verified', cardinality(v_keys) > 0,
    'keys', to_jsonb(v_keys),
    'legacy_keys', to_jsonb(v_legacy),
    'has_phone', v_has_phone,
    'relay_only', v_relay_only
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_referral_identity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_identity(uuid) TO service_role;

-- The keys to STORE on a row: canonical only.
CREATE OR REPLACE FUNCTION public.waves_identity_keys(p_profile uuid) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), '{}')
    FROM jsonb_array_elements_text(public.waves_referral_identity(p_profile) -> 'keys') k;
$$;

-- The keys to MATCH a row with: canonical and legacy, so a row stamped before
-- this migration (an unsalted hash of the raw email) still counts.
CREATE OR REPLACE FUNCTION public.waves_identity_lookup_keys(p_profile uuid) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}')
    FROM (
      SELECT k FROM jsonb_array_elements_text(public.waves_referral_identity(p_profile) -> 'keys') k
      UNION ALL
      SELECT k FROM jsonb_array_elements_text(public.waves_referral_identity(p_profile) -> 'legacy_keys') k
    ) AS all_keys(k);
$$;

REVOKE ALL ON FUNCTION public.waves_identity_keys(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_keys(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_identity_lookup_keys(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_lookup_keys(uuid) TO service_role;

-- 4. Device keys --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waves_device_keys(p_profile uuid) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(array_agg(DISTINCT public.waves_identity_hash('device', d.device_id)), '{}')
    FROM public.device_sessions d
   WHERE d.profile_id = p_profile;
$$;

REVOKE ALL ON FUNCTION public.waves_device_keys(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_device_keys(uuid) TO service_role;

-- 5. The per-profile lock -------------------------------------------------------------
-- Held for the rest of the transaction. Deletion takes it before the snapshot
-- and keeps it through the DELETE; restoration and every reservation take it
-- too, so none of them can run between the snapshot and the cascade.
CREATE OR REPLACE FUNCTION public.waves_profile_lock(p_profile uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('profile:' || p_profile::text, 0));
$$;

REVOKE ALL ON FUNCTION public.waves_profile_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_profile_lock(uuid) TO service_role;

-- 6. Tombstones and carry-over ---------------------------------------------------------

CREATE TABLE public.identity_tombstones (
    identity_key      text NOT NULL,
    first_seen_at     timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at      timestamp with time zone DEFAULT now() NOT NULL,
    seen_count        integer DEFAULT 1 NOT NULL,
    deleted_count     integer DEFAULT 0 NOT NULL,
    last_deleted_at   timestamp with time zone,
    last_auth_user_id uuid,
    CONSTRAINT identity_tombstones_pkey PRIMARY KEY (identity_key),
    CONSTRAINT identity_tombstones_key_shape CHECK (identity_key ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.identity_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.identity_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.identity_tombstones TO service_role;

-- The month's meters at the moment of deletion. `month` is 'YYYY-MM' for a
-- monthly meter and 'YYYY-MM-DD' for an ad reward (its day matters for the
-- daily cap). `ref` is the ad's ORIGINAL transaction id (a restored reward's
-- 'carry:' prefix stripped), unique: one carry-over row per reward, ever,
-- however many times the account is deleted and restored.
CREATE TABLE public.usage_carryover (
    id            uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id  uuid NOT NULL,
    identity_keys text[] DEFAULT '{}'::text[] NOT NULL,
    month         text NOT NULL,
    feature       text NOT NULL,
    amount        numeric(12, 2) NOT NULL,
    ref           text,
    created_at    timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_carryover_pkey PRIMARY KEY (id),
    CONSTRAINT usage_carryover_month_shape CHECK (month ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
    CONSTRAINT usage_carryover_amount_nonneg CHECK (amount >= 0),
    CONSTRAINT usage_carryover_ref_origin CHECK (ref IS NULL OR ref NOT LIKE 'carry:%')
);
CREATE INDEX usage_carryover_auth_user_idx ON public.usage_carryover USING btree (auth_user_id, month);
CREATE INDEX usage_carryover_identity_idx ON public.usage_carryover USING gin (identity_keys);
CREATE UNIQUE INDEX usage_carryover_ref_key ON public.usage_carryover USING btree (ref) WHERE ref IS NOT NULL;

ALTER TABLE public.usage_carryover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.usage_carryover FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.usage_carryover TO service_role;

-- Which profiles have had their restoration run, and for WHICH identity: the
-- fingerprint (sha256 of the sorted canonical keys, '' while unverified) at
-- the time. A reservation whose current fingerprint differs — a phone or email
-- confirmed since — restores again first. So a verification whose restore
-- failed and rolled back leaves a stale fingerprint, not a free pass. Cascades
-- with the profile, so a re-created row starts unrestored.
CREATE TABLE public.usage_restore_marks (
    profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    fingerprint text DEFAULT '' NOT NULL,
    restored_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT usage_restore_marks_pkey PRIMARY KEY (profile_id)
);

-- The identity fingerprint a mark is tied to.
CREATE OR REPLACE FUNCTION public.waves_identity_fingerprint(p_profile uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(
    (SELECT encode(sha256(convert_to(string_agg(k, ','), 'UTF8')), 'hex')
       FROM unnest(public.waves_identity_keys(p_profile)) k),
    '');
$$;

REVOKE ALL ON FUNCTION public.waves_identity_fingerprint(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_fingerprint(uuid) TO service_role;

ALTER TABLE public.usage_restore_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.usage_restore_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.usage_restore_marks TO service_role;

-- Record that these keys were seen (verified) or deleted.
CREATE OR REPLACE FUNCTION public.waves_identity_touch(p_profile uuid, p_deleted boolean DEFAULT false) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_keys text[] := public.waves_identity_keys(p_profile);
BEGIN
  INSERT INTO public.identity_tombstones AS t
    (identity_key, seen_count, deleted_count, last_deleted_at, last_auth_user_id)
  SELECT k, CASE WHEN p_deleted THEN 0 ELSE 1 END, CASE WHEN p_deleted THEN 1 ELSE 0 END,
         CASE WHEN p_deleted THEN now() END, p_profile
    FROM unnest(v_keys) k
  ON CONFLICT (identity_key) DO UPDATE
    SET last_seen_at      = now(),
        seen_count        = t.seen_count + CASE WHEN p_deleted THEN 0 ELSE 1 END,
        deleted_count     = t.deleted_count + CASE WHEN p_deleted THEN 1 ELSE 0 END,
        last_deleted_at   = CASE WHEN p_deleted THEN now() ELSE t.last_deleted_at END,
        last_auth_user_id = p_profile;
  RETURN cardinality(v_keys);
END
$$;

REVOKE ALL ON FUNCTION public.waves_identity_touch(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_touch(uuid, boolean) TO service_role;

-- Copy this month's meters out before the profile row goes. Under the profile
-- lock, which the caller (deletion) keeps through the DELETE. Also stamps every
-- identity the account holds right now into its trial and referral rows (a
-- phone confirmed after the trial was granted used to be forgotten).
CREATE OR REPLACE FUNCTION public.waves_usage_snapshot(p_profile uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_keys  text[];
  v_rows  integer := 0;
  v_n     integer;
BEGIN
  IF p_profile IS NULL THEN RETURN 0; END IF;
  PERFORM public.waves_profile_lock(p_profile);
  v_keys := public.waves_identity_keys(p_profile);

  INSERT INTO public.usage_carryover (auth_user_id, identity_keys, month, feature, amount)
  SELECT p_profile, v_keys, u.month, f.feature, f.amount
    FROM public.voice_agent_usage u
    CROSS JOIN LATERAL (VALUES
      ('voice:count', u.count::numeric),
      ('voice:stream_mints', u.stream_mints::numeric),
      ('voice:followups', u.followups::numeric),
      ('voice:stream_seconds', u.stream_seconds)
    ) AS f(feature, amount)
   WHERE u.profile_id = p_profile AND u.month = v_month AND f.amount > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  INSERT INTO public.usage_carryover (auth_user_id, identity_keys, month, feature, amount)
  SELECT p_profile, v_keys, a.month, 'ai:' || a.feature, a.count
    FROM public.ai_usage a
   WHERE a.profile_id = p_profile AND a.month = v_month AND a.count > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- One row per ORIGINAL reward: a restored reward ('carry:<origin>') names
  -- its origin, and an origin already carried is only re-pointed at this
  -- account and its current keys.
  INSERT INTO public.usage_carryover AS c (auth_user_id, identity_keys, month, feature, amount, ref)
  SELECT p_profile, v_keys, to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
         'ad:' || r.kind, r.amount, regexp_replace(r.transaction_id, '^(carry:)+', '')
    FROM public.ad_rewards r
   WHERE r.profile_id = p_profile
     AND r.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  ON CONFLICT (ref) WHERE ref IS NOT NULL DO UPDATE
    SET auth_user_id  = EXCLUDED.auth_user_id,
        identity_keys = (SELECT COALESCE(array_agg(DISTINCT k), '{}') FROM unnest(c.identity_keys || EXCLUDED.identity_keys) k);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  -- Identities confirmed since the trial / referral was stamped travel with it.
  IF cardinality(v_keys) > 0 THEN
    UPDATE public.pro_trials t
       SET identity_keys = (SELECT array_agg(DISTINCT k) FROM unnest(t.identity_keys || v_keys) k)
     WHERE t.profile_id = p_profile;
    UPDATE public.referrals r
       SET identity_keys = (SELECT array_agg(DISTINCT k) FROM unnest(r.identity_keys || v_keys) k)
     WHERE r.referee_id = p_profile;
    UPDATE public.referrals r
       SET referrer_keys = (SELECT array_agg(DISTINCT k) FROM unnest(r.referrer_keys || v_keys) k)
     WHERE r.referrer_id = p_profile;
  END IF;

  PERFORM public.waves_identity_touch(p_profile, true);
  RETURN v_rows;
END
$$;

REVOKE ALL ON FUNCTION public.waves_usage_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_usage_snapshot(uuid) TO service_role;

-- Bring the month's meters back for a profile that is the same auth user, or
-- the same verified identity, as a deleted one. Takes the larger count, so it
-- is safe to run more than once and never lowers anything. Raises on any
-- failure: the caller (the guard) then refuses the reservation.
CREATE OR REPLACE FUNCTION public.waves_usage_restore(p_profile uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_month text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM');
  v_keys  text[];
  r       record;
  v_rows  integer := 0;
BEGIN
  IF p_profile IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    RETURN 0;
  END IF;
  PERFORM public.waves_profile_lock(p_profile);
  v_keys := public.waves_identity_lookup_keys(p_profile);

  FOR r IN
    SELECT c.month, c.feature, max(c.amount) AS amount, c.ref
      FROM public.usage_carryover c
     WHERE c.month LIKE v_month || '%'
       AND (c.auth_user_id = p_profile
            OR (cardinality(v_keys) > 0 AND c.identity_keys && v_keys))
     GROUP BY c.month, c.feature, c.ref
  LOOP
    IF r.feature LIKE 'voice:%' THEN
      INSERT INTO public.voice_agent_usage AS u (profile_id, month, count, stream_mints, followups, stream_seconds, updated_at)
      VALUES (p_profile, r.month,
              CASE WHEN r.feature = 'voice:count' THEN r.amount::int ELSE 0 END,
              CASE WHEN r.feature = 'voice:stream_mints' THEN r.amount::int ELSE 0 END,
              CASE WHEN r.feature = 'voice:followups' THEN r.amount::int ELSE 0 END,
              CASE WHEN r.feature = 'voice:stream_seconds' THEN r.amount ELSE 0 END,
              now())
      ON CONFLICT (profile_id, month) DO UPDATE
        SET count          = GREATEST(u.count, EXCLUDED.count),
            stream_mints   = GREATEST(u.stream_mints, EXCLUDED.stream_mints),
            followups      = GREATEST(u.followups, EXCLUDED.followups),
            stream_seconds = GREATEST(u.stream_seconds, EXCLUDED.stream_seconds),
            updated_at     = now();
      v_rows := v_rows + 1;
    ELSIF r.feature LIKE 'ai:%' THEN
      INSERT INTO public.ai_usage AS a (profile_id, month, feature, count, updated_at)
      VALUES (p_profile, r.month, substr(r.feature, 4), r.amount::int, now())
      ON CONFLICT (profile_id, month, feature) DO UPDATE
        SET count = GREATEST(a.count, EXCLUDED.count), updated_at = now();
      v_rows := v_rows + 1;
    ELSIF r.feature LIKE 'ad:%' AND r.ref IS NOT NULL THEN
      -- Keep the day (the daily cap) but never a time in the future. The
      -- transaction id names the origin, so a second restore is a no-op.
      INSERT INTO public.ad_rewards (profile_id, kind, amount, transaction_id, ad_unit, created_at)
      VALUES (p_profile, substr(r.feature, 4), r.amount::int, 'carry:' || r.ref, 'carryover',
              LEAST(now(), (r.month || 'T12:00:00Z')::timestamptz))
      ON CONFLICT (transaction_id) DO NOTHING;
      v_rows := v_rows + 1;
    END IF;
  END LOOP;

  RETURN v_rows;
END
$$;

REVOKE ALL ON FUNCTION public.waves_usage_restore(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_usage_restore(uuid) TO service_role;

-- The guard every reservation runs first: the profile lock, the profile must
-- exist, and the restoration must have run for this profile row AND this
-- identity (the mark's fingerprint). If restoring fails the exception
-- propagates and the reservation is refused — nobody spends on meters that may
-- be missing what they already used.
CREATE OR REPLACE FUNCTION public.waves_usage_guard(p_profile uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_fp text;
BEGIN
  IF p_profile IS NULL THEN
    RAISE EXCEPTION 'waves_usage_guard needs a profile';
  END IF;
  PERFORM public.waves_profile_lock(p_profile);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    RAISE EXCEPTION 'NO_SUCH_PROFILE' USING ERRCODE = 'foreign_key_violation';
  END IF;
  v_fp := public.waves_identity_fingerprint(p_profile);
  IF NOT EXISTS (
    SELECT 1 FROM public.usage_restore_marks m
     WHERE m.profile_id = p_profile AND m.fingerprint = v_fp
  ) THEN
    PERFORM public.waves_usage_restore(p_profile);
    INSERT INTO public.usage_restore_marks (profile_id, fingerprint) VALUES (p_profile, v_fp)
    ON CONFLICT (profile_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, restored_at = now();
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.waves_usage_guard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_usage_guard(uuid) TO service_role;

-- A profile inserted (or re-inserted) is restored at once, by auth user id or
-- by identity. A failure here is logged, not raised — it must not block a
-- sign-up — and leaves no mark, so the first reservation retries and refuses
-- if it still cannot (waves_usage_guard).
CREATE OR REPLACE FUNCTION public.waves_profile_after_insert_restore() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  BEGIN
    PERFORM public.waves_usage_guard(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'usage restore failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_profile_after_insert_restore() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_profile_after_insert_restore() TO service_role;

DROP TRIGGER IF EXISTS profiles_usage_restore ON public.profiles;
CREATE TRIGGER profiles_usage_restore AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.waves_profile_after_insert_restore();

-- At verification (the moment the pro-trial trigger already fires): remember
-- the identity, union any newly confirmed key into this account's trial and
-- referral rows, and restore a deleted account's month by identity.
CREATE OR REPLACE FUNCTION public.waves_identity_after_verify(p_profile uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_keys text[];
  v_devs text[];
BEGIN
  PERFORM public.waves_profile_lock(p_profile);
  v_keys := public.waves_identity_keys(p_profile);
  v_devs := public.waves_device_keys(p_profile);
  IF cardinality(v_keys) = 0 THEN RETURN; END IF;
  PERFORM public.waves_identity_touch(p_profile, false);
  UPDATE public.pro_trials t
     SET identity_keys = (SELECT array_agg(DISTINCT k) FROM unnest(t.identity_keys || v_keys) k),
         device_keys   = (SELECT COALESCE(array_agg(DISTINCT k), '{}') FROM unnest(t.device_keys || v_devs) k)
   WHERE t.profile_id = p_profile;
  UPDATE public.referrals r
     SET identity_keys = (SELECT array_agg(DISTINCT k) FROM unnest(r.identity_keys || v_keys) k)
   WHERE r.referee_id = p_profile AND r.status = 'rewarded';
  UPDATE public.referrals r
     SET referrer_keys = (SELECT array_agg(DISTINCT k) FROM unnest(r.referrer_keys || v_keys) k)
   WHERE r.referrer_id = p_profile;
  -- Restore for the identity as it is now; the mark records that fingerprint.
  -- Should this raise and roll back, the mark keeps its old fingerprint and
  -- the next reservation restores (or refuses) under waves_usage_guard.
  PERFORM public.waves_usage_restore(p_profile);
  INSERT INTO public.usage_restore_marks (profile_id, fingerprint)
  VALUES (p_profile, public.waves_identity_fingerprint(p_profile))
  ON CONFLICT (profile_id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, restored_at = now();
END
$$;

REVOKE ALL ON FUNCTION public.waves_identity_after_verify(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_after_verify(uuid) TO service_role;

-- 7. The trial: canonical identity, device signal ------------------------------------

ALTER TABLE public.pro_trials ADD COLUMN IF NOT EXISTS device_keys text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.pro_trials ADD COLUMN IF NOT EXISTS device_reused boolean DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS pro_trials_device_idx ON public.pro_trials USING gin (device_keys);
ALTER TABLE public.pro_trials DROP CONSTRAINT IF EXISTS pro_trials_outcome_known;
ALTER TABLE public.pro_trials ADD CONSTRAINT pro_trials_outcome_known
  CHECK (outcome = ANY (ARRAY['granted'::text, 'skipped_has_plan'::text, 'refused_device'::text]));

-- waves_pro_trial_grant from 20261015220000_pro_trial, with: canonical keys
-- stored, legacy keys matched; locks on every key (canonical and legacy) in a
-- fixed order; the device signal; and `refused_device` for an Apple relay-only
-- email on a device that already had a trial (a relay address is minted per
-- sign-in and would otherwise be a trial a day).
CREATE OR REPLACE FUNCTION public.waves_pro_trial_grant(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set    public.pro_trial_settings%ROWTYPE;
  v_ident  jsonb;
  v_keys   text[];
  v_lookup text[];
  v_devs   text[];
  v_joined timestamptz;
  v_end    timestamptz;
  v_key    text;
  v_dev_hit boolean := false;
BEGIN
  IF p_profile IS NULL THEN RETURN jsonb_build_object('granted', false, 'reason', 'NONE'); END IF;
  SELECT * INTO v_set FROM public.pro_trial_settings WHERE id;
  IF NOT FOUND THEN RETURN jsonb_build_object('granted', false, 'reason', 'OFF'); END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'NO_SUCH_PROFILE');
  END IF;
  IF public.waves_is_guest(p_profile) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'GUEST');
  END IF;

  v_ident := public.waves_referral_identity(p_profile);
  IF NOT COALESCE((v_ident ->> 'verified')::boolean, false) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'NOT_VERIFIED');
  END IF;
  v_keys := public.waves_identity_keys(p_profile);
  v_lookup := public.waves_identity_lookup_keys(p_profile);
  v_devs := public.waves_device_keys(p_profile);

  v_joined := public.waves_referral_joined_at(p_profile);
  IF v_joined IS NULL OR v_joined < v_set.launched_at THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'EXISTING_ACCOUNT');
  END IF;

  -- Serialise per person and per identity (sorted) so two sign-ups of one
  -- phone or email cannot both pass the checks below.
  PERFORM pg_advisory_xact_lock(hashtextextended('pro_trial:' || p_profile::text, 0));
  FOREACH v_key IN ARRAY v_lookup LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('pro_trial_key:' || v_key, 0));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.pro_trials WHERE profile_id = p_profile) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'ALREADY_GRANTED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.pro_trials WHERE identity_keys && v_lookup) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'IDENTITY_REUSED');
  END IF;

  -- The device signal: on its own it only marks the row (a family phone is not
  -- fraud); with nothing but a relay email behind it, it is the only identity
  -- there is, and it has had its trial.
  v_dev_hit := cardinality(v_devs) > 0 AND EXISTS (
    SELECT 1 FROM public.pro_trials t WHERE t.outcome = 'granted' AND t.device_keys && v_devs
  );
  IF v_dev_hit AND COALESCE((v_ident ->> 'relay_only')::boolean, false) THEN
    INSERT INTO public.pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys, device_keys, device_reused)
    VALUES (p_profile, 'refused_device', now(), now(), v_keys, v_devs, true)
    ON CONFLICT (profile_id) DO NOTHING;
    RETURN jsonb_build_object('granted', false, 'reason', 'DEVICE_REUSED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.profile_id = p_profile
       AND s.tier IN ('plus', 'pro')
       AND s.status IN ('active', 'grace')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) THEN
    INSERT INTO public.pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys, device_keys, device_reused)
    VALUES (p_profile, 'skipped_has_plan', now(), now(), v_keys, v_devs, v_dev_hit)
    ON CONFLICT (profile_id) DO NOTHING;
    RETURN jsonb_build_object('granted', false, 'reason', 'HAS_PLAN');
  END IF;

  v_end := now() + make_interval(days => v_set.days);
  INSERT INTO public.pro_trials (profile_id, outcome, granted_at, expires_at, identity_keys, device_keys, device_reused)
  VALUES (p_profile, 'granted', now(), v_end, v_keys, v_devs, v_dev_hit);
  INSERT INTO public.subscriptions
    (profile_id, tier, period, status, current_period_end, store, store_txn_id)
  VALUES (p_profile, 'pro', 'monthly', 'active', v_end, 'trial', 'trial:' || p_profile::text)
  ON CONFLICT (store_txn_id) DO NOTHING;

  RETURN jsonb_build_object('granted', true, 'expires_at', v_end, 'days', v_set.days, 'device_reused', v_dev_hit);
END
$$;

REVOKE ALL ON FUNCTION public.waves_pro_trial_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_pro_trial_grant(uuid) TO service_role;

-- The verification trigger (20261015220000_pro_trial), now also the identity hook.
CREATE OR REPLACE FUNCTION public.waves_pro_trial_after_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_old jsonb;
  v_new jsonb := to_jsonb(NEW);
  k     text;
  v_changed boolean := TG_OP = 'INSERT';
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD);
      FOREACH k IN ARRAY ARRAY['is_anonymous', 'phone', 'phone_confirmed_at', 'email', 'email_confirmed_at'] LOOP
        IF (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN v_changed := true; END IF;
      END LOOP;
    END IF;
    IF v_changed THEN
      -- Two subtransactions: a failing trial grant must not roll back the
      -- identity hook, nor the other way round.
      BEGIN
        PERFORM public.waves_identity_after_verify(NEW.id);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'identity hook failed for %: %', NEW.id, SQLERRM;
      END;
      PERFORM public.waves_pro_trial_grant(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pro trial grant failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_pro_trial_after_auth_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_pro_trial_after_auth_user() TO service_role;

-- A device registered after the trial was granted is stamped onto it.
CREATE OR REPLACE FUNCTION public.waves_device_after_register_stamp() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_key text;
BEGIN
  BEGIN
    v_key := public.waves_identity_hash('device', NEW.device_id);
    UPDATE public.pro_trials t
       SET device_keys = t.device_keys || v_key
     WHERE t.profile_id = NEW.profile_id AND NOT (t.device_keys @> ARRAY[v_key]);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'device stamp failed for %: %', NEW.profile_id, SQLERRM;
  END;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_device_after_register_stamp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_device_after_register_stamp() TO service_role;

DROP TRIGGER IF EXISTS device_sessions_trial_stamp ON public.device_sessions;
CREATE TRIGGER device_sessions_trial_stamp AFTER INSERT ON public.device_sessions
  FOR EACH ROW EXECUTE FUNCTION public.waves_device_after_register_stamp();

-- 8. Referrals outlive their accounts --------------------------------------------------

ALTER TABLE public.referrals ALTER COLUMN referrer_id DROP NOT NULL;
ALTER TABLE public.referrals ALTER COLUMN referee_id DROP NOT NULL;
ALTER TABLE public.referrals ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_referrer_fkey;
ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_referee_fkey;
ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_code_fkey;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_referrer_fkey FOREIGN KEY (referrer_id)
  REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_referee_fkey FOREIGN KEY (referee_id)
  REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_code_fkey FOREIGN KEY (code)
  REFERENCES public.referral_codes(code) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_not_self;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_not_self
  CHECK (referrer_id IS NULL OR referee_id IS NULL OR referrer_id <> referee_id);
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referrer_keys text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS device_keys text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS referrer_device_keys text[] DEFAULT '{}'::text[] NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_keys_idx ON public.referrals USING gin (referrer_keys);

-- Never granted to clients: the hashes are the abuse check's own.
REVOKE SELECT (identity_keys, referrer_keys, device_keys, referrer_device_keys) ON TABLE public.referrals FROM authenticated;

-- Days earned by the person, or by any earlier account with the same identity.
CREATE OR REPLACE FUNCTION public.waves_referral_days_earned(p_profile uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_keys text[] := public.waves_identity_lookup_keys(p_profile);
  v_days integer;
BEGIN
  SELECT (
    COALESCE((SELECT sum(referrer_days) FROM public.referrals
               WHERE referrer_id = p_profile
                  OR (cardinality(v_keys) > 0 AND referrer_keys && v_keys)), 0)
    + COALESCE((SELECT sum(referee_days) FROM public.referrals
                 WHERE referee_id = p_profile
                    OR (cardinality(v_keys) > 0 AND identity_keys && v_keys)), 0)
  )::int INTO v_days;
  RETURN v_days;
END
$$;

REVOKE ALL ON FUNCTION public.waves_referral_days_earned(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_days_earned(uuid) TO service_role;

-- waves_referral_try_qualify from 20261015170000_referral_new_user_window, with
-- canonical keys stored and legacy keys matched, the referrer's keys stamped on
-- the row, the device rule (SAME_DEVICE), and every participant profile and
-- identity key locked, in a fixed order, BEFORE the reuse and cap checks: two
-- alias accounts qualifying together cannot both pass.
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
  v_earned_a int;
  v_earned_b int;
  v_days_a   int;
  v_days_b   int;
  v_key      text;
  v_referrer uuid;
BEGIN
  IF p_referee IS NULL THEN RETURN jsonb_build_object('rewarded', false, 'reason', 'NONE'); END IF;

  -- Lock order, the same as deletion and verification: the participants'
  -- profile locks FIRST (sorted), the referral row after. A peek finds the
  -- referrer; the row is re-read under the locks and must still be pending.
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

  -- 4. Locks: every identity key of both sides (sorted; the profile locks were
  --    taken above). The same order everywhere, so no two qualifications
  --    deadlock and none can read a stale "not rewarded yet" / "earned so far".
  FOR v_key IN
    SELECT DISTINCT k FROM unnest(v_lookup || v_ref_lookup) k ORDER BY k
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('referral_key:' || v_key, 0));
  END LOOP;

  -- 5. One reward per identity: not the referrer's, not the referrer's phone,
  --    not an earlier friend's (rows outlive deleted accounts).
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

  -- 6. Reward both, under the locks above.
  v_earned_a := public.waves_referral_days_earned(r.referrer_id);
  v_earned_b := public.waves_referral_days_earned(p_referee);
  v_days_a := GREATEST(0, LEAST(7, 30 - v_earned_a));
  v_days_b := GREATEST(0, LEAST(7, 30 - v_earned_b));

  PERFORM public.waves_referral_grant(r.referrer_id, v_days_a, 'referral:' || r.id::text || ':referrer');
  PERFORM public.waves_referral_grant(p_referee,     v_days_b, 'referral:' || r.id::text || ':referee');

  UPDATE public.referrals
     SET status = 'rewarded', qualified_at = now(), referrer_days = v_days_a,
         referee_days = v_days_b, identity_keys = v_keys, referrer_keys = v_ref_keys,
         device_keys = v_devs, referrer_device_keys = v_ref_devs
   WHERE id = r.id;

  RETURN jsonb_build_object('rewarded', true, 'referrer_days', v_days_a, 'referee_days', v_days_b);
END
$$;

REVOKE ALL ON FUNCTION public.waves_referral_try_qualify(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_referral_try_qualify(uuid) TO service_role;

-- The admin list reads through deleted participants.
CREATE OR REPLACE FUNCTION public.waves_admin_referrals(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, referrer_id uuid, referrer_name text, referee_id uuid, referee_name text,
              source text, status text, reject_reason text, claimed_at timestamp with time zone,
              qualified_at timestamp with time zone, referrer_days integer, referee_days integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT r.id, r.referrer_id, COALESCE(a.display_name, '(deleted)'), r.referee_id,
         COALESCE(b.display_name, '(deleted)'),
         r.source, r.status, r.reject_reason, r.claimed_at, r.qualified_at,
         r.referrer_days, r.referee_days
    FROM public.referrals r
    LEFT JOIN public.profiles a ON a.id = r.referrer_id
    LEFT JOIN public.profiles b ON b.id = r.referee_id
   ORDER BY r.claimed_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;

REVOKE ALL ON FUNCTION public.waves_admin_referrals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_referrals(integer) TO service_role;

-- 9. profiles.created_at is the server's ---------------------------------------------
CREATE OR REPLACE FUNCTION public.waves_guard_profile_timestamps() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_role text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
BEGIN
  IF v_role IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := now();
    ELSE
      NEW.created_at := OLD.created_at;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS profiles_guard_timestamps ON public.profiles;
CREATE TRIGGER profiles_guard_timestamps BEFORE INSERT OR UPDATE OF created_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.waves_guard_profile_timestamps();

-- waves_ads_eligibility from 20261016120000_two_tiers_free_and_pro: the account's
-- age is counted from verification (phone / email / OAuth), not from the guest
-- profile's creation.
CREATE OR REPLACE FUNCTION public.waves_ads_eligibility(p_profile uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_set     public.ad_reward_settings%ROWTYPE;
  v_created timestamptz;
  v_joined  timestamptz;
  v_today   integer := 0;
  v_reason  text;
BEGIN
  SELECT * INTO v_set FROM public.ad_reward_settings WHERE id;
  SELECT created_at INTO v_created FROM public.profiles WHERE id = p_profile;
  IF p_profile IS NOT NULL THEN
    SELECT count(*)::integer INTO v_today
      FROM public.ad_rewards r
     WHERE r.profile_id = p_profile
       AND r.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
    v_joined := COALESCE(public.waves_referral_joined_at(p_profile), v_created);
  END IF;

  IF p_profile IS NULL OR v_created IS NULL OR NOT public.waves_ads_enabled(p_profile) THEN
    v_reason := 'disabled';
  ELSIF public.waves_is_guest(p_profile) THEN
    v_reason := 'guest';
  ELSIF GREATEST(v_created, v_joined) > now() - make_interval(days => v_set.min_account_age_days) THEN
    v_reason := 'too_new';
  ELSIF public.waves_pro_trial_active(p_profile) IS NOT NULL
        OR public.waves_voice_trial_until(p_profile) IS NOT NULL THEN
    v_reason := 'trial';
  ELSIF COALESCE(public.waves_my_plan(p_profile) ->> 'plan', 'free') <> 'free'
        OR EXISTS (
          SELECT 1 FROM public.subscriptions s
           WHERE s.profile_id = p_profile
             AND s.tier IN ('plus', 'pro')
             AND s.status IN ('active', 'grace')
             AND (s.current_period_end IS NULL OR s.current_period_end > now())
        ) THEN
    v_reason := 'paid';
  ELSIF v_today >= v_set.daily_cap THEN
    v_reason := 'capped';
  END IF;

  RETURN jsonb_build_object(
    'eligible', v_reason IS NULL,
    'reason', v_reason,
    'usedToday', v_today,
    'dailyCap', v_set.daily_cap,
    'voicePerAd', v_set.voice_per_ad,
    'scansPerAd', v_set.scans_per_ad
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_ads_eligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_ads_eligibility(uuid) TO service_role;

-- 10. Deletion keeps the month -------------------------------------------------------
-- waves_delete_my_account from the baseline, with the profile lock taken first
-- (held through the DELETE) and the snapshot before the row goes.
CREATE OR REPLACE FUNCTION public.waves_delete_my_account(p_feedback text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_memberships integer;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  -- No reservation may land between the snapshot and the cascade.
  PERFORM public.waves_profile_lock(v_profile);

  -- While there is still an author to attribute it to. It outlives the row.
  IF length(trim(COALESCE(p_feedback, ''))) > 0 THEN
    PERFORM public.waves_submit_feedback(p_feedback, 'deletion');
  END IF;

  -- The month's meters and the identities, before the cascade takes them.
  PERFORM public.waves_usage_snapshot(v_profile);

  UPDATE public.group_members
     SET profile_id = NULL,
         ghost_name = 'Former member',
         payment_handle = NULL,
         payment_rail = NULL,
         vpa = NULL,
         invite_email = NULL,
         invite_phone = NULL
   WHERE profile_id = v_profile;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  DELETE FROM public.profiles WHERE id = v_profile;

  RETURN jsonb_build_object(
    'ok', true,
    'memberships_anonymised', v_memberships
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_delete_my_account(text) TO authenticated, service_role;

-- 11. Backfill ---------------------------------------------------------------------------
-- Every trial and referral row whose accounts still exist gets its canonical
-- keys and device keys UNIONED in now, so an alias of an existing trial is
-- refused from the first day. History is never replaced: keys already on a row
-- (legacy, or confirmed later) stay, so running this again is always safe.
-- Where the auth identity is already gone nothing can be added; those rows
-- keep their legacy keys, which the lookups still match for the unchanged
-- address (an alias of a deleted legacy email is a documented residual).
CREATE OR REPLACE FUNCTION public.waves_identity_backfill(p_profile uuid DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rows integer := 0;
  v_n    integer;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RETURN 0; END IF;

  UPDATE public.pro_trials t
     SET identity_keys = (SELECT COALESCE(array_agg(DISTINCT k), '{}')
                            FROM unnest(t.identity_keys || public.waves_identity_keys(t.profile_id)) k),
         device_keys   = (SELECT COALESCE(array_agg(DISTINCT k), '{}')
                            FROM unnest(t.device_keys || public.waves_device_keys(t.profile_id)) k)
   WHERE (p_profile IS NULL OR t.profile_id = p_profile)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.profile_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  UPDATE public.referrals r
     SET identity_keys = (SELECT COALESCE(array_agg(DISTINCT k), '{}')
                            FROM unnest(r.identity_keys || public.waves_identity_keys(r.referee_id)) k),
         device_keys   = (SELECT COALESCE(array_agg(DISTINCT k), '{}')
                            FROM unnest(r.device_keys || public.waves_device_keys(r.referee_id)) k)
   WHERE r.referee_id IS NOT NULL
     AND (p_profile IS NULL OR r.referee_id = p_profile);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  UPDATE public.referrals r
     SET referrer_keys = (SELECT COALESCE(array_agg(DISTINCT k), '{}')
                            FROM unnest(r.referrer_keys || public.waves_identity_keys(r.referrer_id)) k),
         referrer_device_keys = (SELECT COALESCE(array_agg(DISTINCT k), '{}')
                                   FROM unnest(r.referrer_device_keys || public.waves_device_keys(r.referrer_id)) k)
   WHERE r.referrer_id IS NOT NULL
     AND (p_profile IS NULL OR r.referrer_id = p_profile);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_rows := v_rows + v_n;

  RETURN v_rows;
END
$$;

REVOKE ALL ON FUNCTION public.waves_identity_backfill(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_identity_backfill(uuid) TO service_role;

SELECT public.waves_identity_backfill(NULL);
