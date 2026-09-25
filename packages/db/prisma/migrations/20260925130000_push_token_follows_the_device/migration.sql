-- A device's push token follows whoever is signed in on it.
--
-- An Expo push token names a *device*, not a person: the same iPad hands back
-- the same token whoever signs in on it, and `push_tokens` keeps one row per
-- token (`push_tokens_expo_push_token_key`). The app registered its token with
-- a plain upsert on that key, under the RLS policy `push_tokens_own`
-- (`profile_id = waves_current_profile_id()`, for every command). So the first
-- person to sign in on a device owned its row, and everyone after them was
-- refused: the upsert became an UPDATE of somebody else's row, RLS rejected
-- it, and `refreshPushToken` reported `save_failed` to nobody.
--
-- Found on an iPad signed out of one account and into another: every
-- notification for the new account was closed out as "no device"
-- (`push_status = failed`, no attempts), while the old account's
-- notifications kept being pushed to the iPad — to whoever was now holding it.
--
-- This function registers the token for the caller and takes it over from any
-- previous owner: the last person to sign in on a device is the one it
-- notifies, which is the model Expo documents. It is SECURITY DEFINER because
-- moving a row out of another profile is exactly what RLS forbids the caller
-- to do directly (ADR-013). What it can do is narrow: it writes one row, keyed
-- by a token the calling device produced, to the caller's own profile.

CREATE FUNCTION public.waves_register_push_token(
  p_token text,
  p_platform text,
  p_device_name text DEFAULT NULL
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: a push token needs somebody to belong to'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Only an Expo token is ever sent anywhere; anything else is not one.
  IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[.+\]$' THEN
    RAISE EXCEPTION 'INVALID_TOKEN: not an Expo push token'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'INVALID_PLATFORM: %', p_platform
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.push_tokens
    (profile_id, expo_push_token, platform, device_name, last_seen_at, revoked_at)
  VALUES
    (v_profile, p_token, p_platform::"DevicePlatform", left(p_device_name, 120), now(), NULL)
  ON CONFLICT (expo_push_token) DO UPDATE
    SET profile_id   = EXCLUDED.profile_id,
        platform     = EXCLUDED.platform,
        device_name  = EXCLUDED.device_name,
        last_seen_at = now(),
        -- A token that comes back is the device returning, whoever it was
        -- revoked by.
        revoked_at   = NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_register_push_token(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_register_push_token(text, text, text) TO authenticated, service_role;
