-- A second live Firebase→GoTrue phone exchange for the same number must not
-- replace the first one. Replacement lets one device claim or close another
-- device's code, and can make the newer request fall through to ordinary SMS
-- delivery. Stale rows are still replaced so an abandoned exchange does not pin
-- the number forever.

CREATE OR REPLACE FUNCTION public.waves_otp_relay_open(p_phone text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_exchange uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.otp_relay (phone, exchange, code, requested_at)
  VALUES (p_phone, v_exchange, NULL, now())
  ON CONFLICT (phone) DO UPDATE
    SET exchange = EXCLUDED.exchange, code = NULL, requested_at = now()
    WHERE public.otp_relay.requested_at <= now() - interval '30 seconds'
  RETURNING exchange INTO v_exchange;

  IF v_exchange IS NULL THEN
    RAISE EXCEPTION 'OTP_RELAY_BUSY: an exchange is already open for this phone'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_exchange;
END;
$$;

REVOKE ALL ON FUNCTION public.waves_otp_relay_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_otp_relay_open(text) TO service_role;
