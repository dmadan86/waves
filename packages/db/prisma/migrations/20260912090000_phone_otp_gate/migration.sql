-- ════════════════════════ Three codes a day, and a door that shuts ═════════
--
-- Sign-in codes cost real money to send and are the surface SMS-pumping fraud
-- aims at: a script asks for codes to numbers it controls on a premium range and
-- takes a cut of the termination fee. The defence is not clever, it is only
-- somewhere the client cannot skip — which is why the counting has always
-- happened in Postgres rather than in the app.
--
-- What changes here is that running out of codes can now have a consequence
-- beyond waiting for tomorrow. A number that burns its whole allowance day after
-- day and never once completes a sign-in is not a person who keeps mistyping;
-- that shape is the whole signature of pumping, and the only thing the old
-- window did about it was let it start again at midnight.
--
-- Three rules, and the middle one is the one that matters:
--
--   1. Three codes to a number a day (`otp_daily_cap`).
--   2. A day where all three were spent and *none* of them was ever used to sign
--      in leaves a strike. A day where somebody did sign in leaves nothing —
--      real people mistype, wait, and try the other phone.
--   3. Three strikes inside a fortnight and the number is blocked outright, for
--      thirty days.
--
-- Every threshold is an `app_config` knob, so tightening the screw during an
-- attack is an admin edit and not a migration. The one thing deliberately not
-- configurable is the *shape*: verification always clears the day.
--
-- A block is not a ban on a person. It is a ban on sending SMS to a number,
-- which is the thing that costs money — every other door into the app (email,
-- Google, Apple, a guest session, an invite link) stays open to whoever is
-- holding that phone, and an admin can lift it.

-- ─────────────────────────────────────────────────── the knobs ──

INSERT INTO public.app_config (key, value, description) VALUES
  ('otp_daily_cap', 3,
   'Sign-in codes allowed to one phone number per day.'),
  ('otp_strikes_to_block', 3,
   'Days of spending the whole allowance without ever signing in before a number is blocked.'),
  ('otp_strike_window_days', 14,
   'How far back strikes are counted.'),
  ('otp_block_days', 30,
   'How long a block lasts. 0 means until an admin lifts it.')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────── what we remember ──

-- One row per number per day on which the allowance ran out with nothing to
-- show for it. Deliberately a day and not a counter: the question is "on how
-- many days has this happened", and a row per day answers it without anybody
-- having to decide when a counter resets.
CREATE TABLE public.phone_otp_strikes (
  phone      text        NOT NULL,
  day        date        NOT NULL,
  hits       integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_otp_strikes_pkey PRIMARY KEY (phone, day),
  CONSTRAINT phone_otp_strikes_phone_shape CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')
);

COMMENT ON TABLE public.phone_otp_strikes IS
  'A day a number spent its whole code allowance and never signed in. Cleared by a successful verification.';

-- A number we will not send to. `until` null means indefinitely — reachable
-- only by setting `otp_block_days` to 0, and liftable by an admin either way.
CREATE TABLE public.phone_blocks (
  phone      text        NOT NULL,
  reason     text        NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  until      timestamptz,
  CONSTRAINT phone_blocks_pkey PRIMARY KEY (phone),
  CONSTRAINT phone_blocks_phone_shape CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT phone_blocks_reason_shape CHECK (reason = ANY (ARRAY['abuse'::text, 'manual'::text]))
);

COMMENT ON TABLE public.phone_blocks IS
  'Numbers no sign-in code will be sent to. Every other way into the app stays open.';

CREATE INDEX phone_blocks_until_idx ON public.phone_blocks (until);

-- Neither table is readable by anyone but the definer functions below and the
-- service role. A list of numbers under attack is not something to hand out,
-- and "is this number blocked" is a question only the sender needs answered.
ALTER TABLE public.phone_otp_strikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_otp_strikes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.phone_blocks FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────── may we send a code ──

-- Answers "may a code go to this number", counts the ask, and decides whether
-- today has earned a strike. One call, because every one of those has to happen
-- together or a concurrent second ask reads a count that is about to change.
--
-- The answer is deliberately *not* detailed. A caller learns that it may not
-- send and roughly when to come back; it is never told whether that is because
-- the number is blocked, because the day is spent, or because the number has
-- never been seen — which would make this an oracle for which numbers are worth
-- attacking. The reason is returned for the log, not for the person.
CREATE FUNCTION public.waves_phone_gate(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cap        integer;
  v_strikes    integer;
  v_window     integer;
  v_block_days integer;
  v_until      timestamptz;
  v_today      date := (now() AT TIME ZONE 'utc')::date;
  v_hits       integer;
  v_struck     integer;
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'waves_phone_gate needs an E.164 number';
  END IF;

  v_cap        := COALESCE((SELECT value FROM public.app_config WHERE key = 'otp_daily_cap'), 3);
  v_strikes    := COALESCE((SELECT value FROM public.app_config WHERE key = 'otp_strikes_to_block'), 3);
  v_window     := COALESCE((SELECT value FROM public.app_config WHERE key = 'otp_strike_window_days'), 14);
  v_block_days := COALESCE((SELECT value FROM public.app_config WHERE key = 'otp_block_days'), 30);

  -- A live block ends it here, and nothing is counted: a blocked number must not
  -- be able to keep its own strike record warm by hammering a door that is shut.
  SELECT until INTO v_until
    FROM public.phone_blocks
   WHERE phone = p_phone
     AND (until IS NULL OR until > now());
  IF FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'blocked',
      'retryAfter', CASE WHEN v_until IS NULL THEN NULL
                         ELSE GREATEST(0, extract(epoch FROM v_until - now())::integer) END
    );
  END IF;

  -- An expired block is cleared rather than left to be stepped over every time.
  DELETE FROM public.phone_blocks WHERE phone = p_phone;

  -- The day's count. `hits` is what this ask makes it, so the cap is met at the
  -- hit that equals it and refused at the one after.
  INSERT INTO public.phone_otp_strikes AS existing (phone, day, hits)
  VALUES (p_phone, v_today, 1)
  ON CONFLICT (phone, day) DO UPDATE SET hits = existing.hits + 1
  RETURNING existing.hits INTO v_hits;

  -- Counted *before* the allowance is checked, and it has to be: a script that
  -- politely stops at three a day would otherwise never reach the paragraph that
  -- blocks it, and would go on spending the whole allowance every day for ever.
  -- A strike is a day whose allowance was fully spent with nothing to show —
  -- `waves_phone_verified` deletes the day the moment a code is actually used,
  -- so a row still standing at the cap is a day nobody signed in on.
  SELECT count(*) INTO v_struck
    FROM public.phone_otp_strikes
   WHERE phone = p_phone
     AND hits >= v_cap
     AND day > v_today - v_window;

  IF v_struck >= v_strikes THEN
    INSERT INTO public.phone_blocks (phone, reason, until)
    VALUES (
      p_phone,
      'abuse',
      CASE WHEN v_block_days = 0 THEN NULL ELSE now() + make_interval(days => v_block_days) END
    )
    ON CONFLICT (phone) DO UPDATE
      SET reason = 'abuse',
          blocked_at = now(),
          until = EXCLUDED.until;

    RETURN jsonb_build_object('allowed', false, 'reason', 'blocked', 'retryAfter', NULL);
  END IF;

  IF v_hits <= v_cap THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'remaining', v_cap - v_hits);
  END IF;

  -- Spent for today, but not yet a pattern. Midnight UTC rather than the
  -- caller's midnight: a number is not in a timezone, and a day that moved with
  -- whoever was asking would be a fourth code for the price of a flight.
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'spent',
    -- `(date)::timestamp AT TIME ZONE 'utc'`, not a cast through text: a plain
    -- cast to timestamptz reads the *session's* time zone, so on a connection
    -- that is not UTC this points at midnight somewhere else and can come back
    -- negative — a "try again in -3 hours" on the one screen somebody is stuck on.
    'retryAfter',
    extract(epoch FROM (((v_today + 1)::timestamp AT TIME ZONE 'utc') - now()))::integer
  );
END;
$$;

COMMENT ON FUNCTION public.waves_phone_gate(text) IS
  'May a sign-in code go to this number? Counts the ask and blocks a number that spends every day and never signs in.';

REVOKE ALL ON FUNCTION public.waves_phone_gate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_phone_gate(text) TO service_role;

-- ──────────────────────────────────────────── somebody signed in ──

-- Clears the day. Called when a code is actually used, which is the one piece of
-- evidence that separates a person from a script: a pumping run never gets this
-- far, because nobody is reading the SMS.
--
-- The whole day's row goes, not just the strike flag, so a person who burned two
-- codes before the third worked starts tomorrow with a clean slate as well as an
-- unmarked today.
CREATE FUNCTION public.waves_phone_verified(p_phone text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  DELETE FROM public.phone_otp_strikes
   WHERE phone = p_phone
     AND day = (now() AT TIME ZONE 'utc')::date;
$$;

COMMENT ON FUNCTION public.waves_phone_verified(text) IS
  'A code was used. Clears the day so honest mistyping never accrues a strike.';

REVOKE ALL ON FUNCTION public.waves_phone_verified(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_phone_verified(text) TO service_role;

-- ─────────────────────────────────────────────────────── admin ──

-- Lifting a block is a support action, and support has to be able to take it
-- without a psql session. Blocking by hand is the same door in the other
-- direction — a number reported to us, or one an attack is using that has not
-- yet earned its third strike.
CREATE FUNCTION public.waves_admin_phone_unblock(p_phone text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH gone AS (
    DELETE FROM public.phone_blocks WHERE phone = p_phone RETURNING 1
  ), cleared AS (
    DELETE FROM public.phone_otp_strikes WHERE phone = p_phone RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM gone);
$$;

REVOKE ALL ON FUNCTION public.waves_admin_phone_unblock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_phone_unblock(text) TO service_role;

CREATE FUNCTION public.waves_admin_phone_block(p_phone text, p_days integer DEFAULT 30)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.phone_blocks (phone, reason, until)
  VALUES (
    p_phone,
    'manual',
    CASE WHEN COALESCE(p_days, 0) = 0 THEN NULL ELSE now() + make_interval(days => p_days) END
  )
  ON CONFLICT (phone) DO UPDATE
    SET reason = 'manual', blocked_at = now(), until = EXCLUDED.until;
$$;

REVOKE ALL ON FUNCTION public.waves_admin_phone_block(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_admin_phone_block(text, integer) TO service_role;
