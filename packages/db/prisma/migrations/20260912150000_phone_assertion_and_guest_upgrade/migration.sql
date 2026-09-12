-- ═══════════ One proof, used once — and a guest who proves a number is done ═══
--
-- Three things the phone door was missing, and each of them is a way the same
-- feature breaks rather than three separate features.
--
--   1. **A Firebase assertion is single use.** The token is good for ten
--      minutes, and inside that window the *same* token could be replayed: to
--      sign in as the number's owner, and then, from a second account, to attach
--      that number to it. One proof, two irreversible outcomes. What is recorded
--      is `(uid, auth_time)` rather than the token, because an ID token is
--      refreshable — a fresh token minted from the same Firebase session carries
--      the same `auth_time`, so keying on the token itself would pin nothing.
--   2. **A failure that was ours gives the attempt back.** The daily allowance
--      exists to stop somebody spending money on SMS. A relay that timed out or
--      a GoTrue that answered 502 spent no money, and charging the person for it
--      means three of our own failures lock them out for the day.
--   3. **A guest who attaches a number stops being a guest.** ADR-006 makes an
--      anonymous session upgrade *in place* — the account keeps its id and
--      everything in it. That upgrade is `is_anonymous` going false, and the
--      GoTrue admin API that attaches the number does not do it. Without this,
--      somebody with a real, proved contact would still be held to one group and
--      a ten-day read-only trial, which is the ceiling for an account nobody has
--      claimed.

-- ───────────────────────────────────── a proof is worth exactly one use ──

-- One row per Firebase sign-in that has been spent. Small, short-lived, and
-- never read by anything but the functions below: it holds no number and no
-- token, only "this sign-in has already been traded in".
CREATE TABLE public.firebase_assertions (
  uid       text        NOT NULL,
  auth_time bigint      NOT NULL,
  used_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firebase_assertions_pkey PRIMARY KEY (uid, auth_time)
);

COMMENT ON TABLE public.firebase_assertions IS
  'Firebase sign-ins already traded for a session or an attachment. A proof is worth one use.';

CREATE INDEX firebase_assertions_used_at_idx ON public.firebase_assertions (used_at);

ALTER TABLE public.firebase_assertions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.firebase_assertions FROM PUBLIC, anon, authenticated;

-- True the first time and false every time after. `ON CONFLICT DO NOTHING` with
-- the row count is the whole of it: two requests racing with one token both
-- reach the insert, exactly one row appears, and the loser is told so rather
-- than both coming away believing they proved something.
--
-- The prune rides along instead of needing a cron. A token older than the
-- verifier's ten-minute ceiling is refused before this is ever called, so an
-- hour of history is already far more than is useful.
CREATE FUNCTION public.waves_firebase_assertion_use(p_uid text, p_auth_time bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_uid IS NULL OR p_uid = '' OR p_auth_time IS NULL OR p_auth_time <= 0 THEN
    RAISE EXCEPTION 'waves_firebase_assertion_use needs a uid and an auth_time';
  END IF;

  DELETE FROM public.firebase_assertions WHERE used_at < now() - interval '1 hour';

  INSERT INTO public.firebase_assertions (uid, auth_time)
  VALUES (p_uid, p_auth_time)
  ON CONFLICT (uid, auth_time) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.waves_firebase_assertion_use(text, bigint) IS
  'Claims a Firebase sign-in. True the first time, false for every replay of the same proof.';

REVOKE ALL ON FUNCTION public.waves_firebase_assertion_use(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_firebase_assertion_use(text, bigint) TO service_role;

-- Gives the proof back, and only ever for a failure on our side of the wire: a
-- database that could not be reached, a relay that never filled, a GoTrue that
-- answered 502. Somebody whose sign-in fell over on our infrastructure should be
-- able to press the button again with the code they already typed, rather than
-- being sent back to Firebase for a second SMS.
--
-- Never called after anything the person did — a number already on another
-- account, a blocked one, a request with nobody signed in. Those are answers,
-- and an answer has been given for the proof.
CREATE FUNCTION public.waves_firebase_assertion_release(p_uid text, p_auth_time bigint)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  DELETE FROM public.firebase_assertions WHERE uid = p_uid AND auth_time = p_auth_time;
$$;

REVOKE ALL ON FUNCTION public.waves_firebase_assertion_release(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_firebase_assertion_release(text, bigint) TO service_role;

-- ──────────────────────────────── an attempt nobody spent anything on ──

-- Hands back one of the day's three, for the same failures the release above
-- covers. Deliberately not `waves_phone_verified`: that clears the whole day
-- because somebody *proved* they were a person, and using it here would let
-- three failed exchanges wipe a day of genuine evidence that a script is
-- hammering the number.
--
-- The row goes when the count reaches zero rather than sitting at zero, so a day
-- that was only ever refunded looks exactly like a day nothing happened on —
-- which is what it is, and which keeps it off the strike count.
CREATE FUNCTION public.waves_phone_gate_refund(p_phone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  UPDATE public.phone_otp_strikes
     SET hits = GREATEST(0, hits - 1)
   WHERE phone = p_phone
     AND day = v_today;

  DELETE FROM public.phone_otp_strikes
   WHERE phone = p_phone
     AND day = v_today
     AND hits <= 0;
END;
$$;

COMMENT ON FUNCTION public.waves_phone_gate_refund(text) IS
  'Gives back one of the day''s codes after a failure on our side. Never after a refusal the person caused.';

REVOKE ALL ON FUNCTION public.waves_phone_gate_refund(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_phone_gate_refund(text) TO service_role;

-- ──────────────────────────────────── the guest who now has a contact ──

-- ADR-006's in-place upgrade, in the one place it was not happening. Attaching
-- an email goes through GoTrue's own change-verification, which clears
-- `is_anonymous` as part of the flow; attaching a phone goes through the admin
-- API, which does not — it sets the number and nothing else. So the same person,
-- doing the same thing through the other door, stayed a guest: one group, ten
-- days, read-only after, with a proved contact sitting on the account.
--
-- Only ever called for an account that has just had a confirmed contact put on
-- it, and it re-checks that here rather than trusting the caller: a promotion
-- that could be asked for without a proved contact would be a way to lift the
-- ceiling on any anonymous account at all.
--
-- plpgsql and guarded exactly like `waves_is_guest`: CI runs these migrations
-- against a stub `auth` schema whose users table has no `is_anonymous` column,
-- and a SQL body naming a missing column fails at CREATE. Where there is no such
-- column there are no anonymous users, so there is nothing to promote and false
-- is the true answer.
CREATE FUNCTION public.waves_promote_guest(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth'
         AND table_name = 'users'
         AND column_name = 'is_anonymous'
     ) THEN
    RETURN FALSE;
  END IF;

  UPDATE auth.users
     SET is_anonymous = false
   WHERE id = p_user
     AND is_anonymous
     AND (phone_confirmed_at IS NOT NULL OR email_confirmed_at IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.waves_promote_guest(uuid) IS
  'ADR-006 in-place upgrade: an anonymous account with a confirmed contact is no longer a guest.';

REVOKE ALL ON FUNCTION public.waves_promote_guest(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_promote_guest(uuid) TO service_role;
