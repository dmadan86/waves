-- ═════════════════ Handing a code between two of our own functions ═════════
--
-- Firebase can prove somebody is holding a phone. It cannot hand out a Supabase
-- session, and Supabase's admin API has no call that mints one. The usual
-- workaround — set a random password, sign in with it — is closed here, because
-- this app has real password sign-in and overwriting one would silently break
-- the login of anybody who set it.
--
-- So the session is minted the only way GoTrue offers: by completing a phone
-- OTP. `phone-verify` asks GoTrue for a code, GoTrue generates one and posts it
-- to the send hook — which is `otp-send`, ours — and the hook, instead of paying
-- to send an SMS nobody needs, leaves it here for the caller that asked. The
-- round trip is between two of our own functions, in two isolates that cannot
-- share memory, which is the whole reason this table exists.
--
-- What is stored is a live sign-in credential, so it is treated as one:
--
--   * one row per number, and the caller deletes it the moment it is read;
--   * a row is only usable for `OTP_RELAY_TTL_SECONDS` and is refused after;
--   * the table is service-role only, with RLS on and every grant revoked —
--     `authenticated` must not be able to read this any more than `anon`;
--   * `claim` reads and deletes in one statement, so two callers racing cannot
--     both come away with the code.
--
-- Nothing is written here unless a Firebase token was verified first. A row is
-- proof that somebody has already proved themselves; it is not the proof.

CREATE TABLE public.otp_relay (
  phone        text        NOT NULL,
  -- Which exchange this row belongs to. One number can be signed in on two
  -- devices at once, and without this the second `open` silently replaces the
  -- first's row: the first then claims a code minted for somebody else, or
  -- deletes the second's on its way out and sends that person's code to an SMS
  -- nobody asked for. The claim matches on it, so an exchange can only ever take
  -- its own code and a loser fails cleanly instead of stealing.
  exchange     uuid        NOT NULL DEFAULT gen_random_uuid(),
  code         text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_relay_pkey PRIMARY KEY (phone),
  CONSTRAINT otp_relay_phone_shape CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT otp_relay_code_shape CHECK (code IS NULL OR code ~ '^[0-9]{4,10}$')
);

COMMENT ON TABLE public.otp_relay IS
  'A sign-in code in flight between phone-verify and otp-send. Single use, seconds old, service-role only.';

ALTER TABLE public.otp_relay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.otp_relay FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────── open the exchange ──

-- Says "the next code for this number is mine, do not send it", and returns the
-- token that says which "mine". Replaces any row already there — a half-finished
-- exchange from a minute ago is not worth keeping — but the replacement gets a
-- new id, so the exchange it displaced can no longer claim or close anything and
-- discovers that rather than quietly taking the newcomer's code.
CREATE FUNCTION public.waves_otp_relay_open(p_phone text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.otp_relay (phone, exchange, code, requested_at)
  VALUES (p_phone, gen_random_uuid(), NULL, now())
  ON CONFLICT (phone) DO UPDATE
    SET exchange = gen_random_uuid(), code = NULL, requested_at = now()
  RETURNING exchange;
$$;

REVOKE ALL ON FUNCTION public.waves_otp_relay_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_otp_relay_open(text) TO service_role;

-- ────────────────────────────────────────────────── park the code ──

-- The hook's side. Returns true when a code was parked, which is the hook's
-- answer to "is this send mine to skip": false means no exchange is waiting and
-- the code is a real one somebody is sitting waiting for.
--
-- The window is deliberately tight. `phone-verify` opens the exchange and calls
-- GoTrue in the same breath, so anything older than a few seconds is a request
-- that went astray, and an unclaimed row must not sit around being fillable.
CREATE FUNCTION public.waves_otp_relay_park(p_phone text, p_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_parked integer;
BEGIN
  UPDATE public.otp_relay
     SET code = p_code
   WHERE phone = p_phone
     AND code IS NULL
     AND requested_at > now() - interval '30 seconds';
  GET DIAGNOSTICS v_parked = ROW_COUNT;
  RETURN v_parked > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.waves_otp_relay_park(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_otp_relay_park(text, text) TO service_role;

-- ───────────────────────────────────────────────── take it and go ──

-- Read and delete in one statement. Two callers racing for the same number must
-- not both come away holding a live code, and a `SELECT` followed by a `DELETE`
-- is exactly the shape that lets them.
CREATE FUNCTION public.waves_otp_relay_claim(p_phone text, p_exchange uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  DELETE FROM public.otp_relay
   WHERE phone = p_phone
     AND exchange = p_exchange
     AND code IS NOT NULL
     AND requested_at > now() - interval '30 seconds'
  RETURNING code;
$$;

REVOKE ALL ON FUNCTION public.waves_otp_relay_claim(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_otp_relay_claim(text, uuid) TO service_role;

-- ──────────────────────────────────────────────────── give up ──

-- Called when the exchange fails, so a row that was never claimed does not sit
-- holding a live code until something else happens to that number.
CREATE FUNCTION public.waves_otp_relay_close(p_phone text, p_exchange uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  DELETE FROM public.otp_relay WHERE phone = p_phone AND exchange = p_exchange;
$$;

REVOKE ALL ON FUNCTION public.waves_otp_relay_close(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_otp_relay_close(text, uuid) TO service_role;
