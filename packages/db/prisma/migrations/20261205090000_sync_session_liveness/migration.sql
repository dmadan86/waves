-- Lets the sync function ask whether a JWT's GoTrue session still exists.
-- waves_sign_out_other_devices deletes the other auth.sessions rows, but the
-- access token a revoked phone already holds stays valid for up to an hour and
-- edge functions do not look at auth.sessions. Service role only.
CREATE OR REPLACE FUNCTION public.waves_session_is_live(p_session uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_session IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (SELECT 1 FROM auth.sessions WHERE id = p_session);
END
$$;

REVOKE ALL ON FUNCTION public.waves_session_is_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_session_is_live(uuid) TO service_role;
