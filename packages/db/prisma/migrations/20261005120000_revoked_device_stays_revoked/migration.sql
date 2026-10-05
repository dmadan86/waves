-- "Log out other devices" has to actually log the other devices out.
--
-- Three gaps, closed here:
--
--   1. `waves_register_device` cleared `revoked_at` on *every* call, so a
--      revoked phone that was merely brought to the foreground (its access
--      token is valid for up to an hour after GoTrue revokes the refresh
--      token) quietly revived its own row, re-occupied a slot, and never
--      learned it had been signed out. A revoked row is now only revived by a
--      session that started *after* the revoke, i.e. a genuine new sign-in.
--      A stale session gets `revoked: true` back instead, and the app signs
--      itself out on seeing it.
--   2. `waves_sign_out_other_devices` only flagged the table. It now also
--      deletes the account's other `auth.sessions` (cascading their refresh
--      tokens), so the revocation is one atomic server-side step and does not
--      depend on the client's separate `signOut({ scope: 'others' })` call
--      having succeeded.
--   3. The registration answer carries `revoked` (false normally).
--
-- The caller's own session id comes from the JWT `session_id` claim. Without
-- the claim (old tokens, tests) the previous behaviour applies.

CREATE OR REPLACE FUNCTION public.waves_register_device(p_device_id text, p_label text DEFAULT 'This device'::text, p_platform text DEFAULT 'unknown'::text, p_app_version text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_tier    text := public.waves_my_plan() ->> 'tier';
  v_limit   int;
  v_active  int;
  v_label   text;
  v_platform text;
  v_known   boolean;
  v_fresh   boolean;
  v_revoked_at timestamptz;
  v_sid     uuid;
  v_session_at timestamptz;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: only a signed-in account has devices'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'BAD_DEVICE_ID: a device id is required'
      USING ERRCODE = 'check_violation';
  END IF;

  v_label    := COALESCE(NULLIF(trim(p_label), ''), 'This device');
  v_platform := COALESCE(NULLIF(trim(p_platform), ''), 'unknown');

  SELECT TRUE, d.revoked_at IS NOT NULL, d.revoked_at
    INTO v_known, v_fresh, v_revoked_at
  FROM public.device_sessions d
  WHERE d.profile_id = v_profile AND d.device_id = p_device_id;

  IF NOT FOUND THEN
    v_known := FALSE;
    v_fresh := TRUE;
  END IF;

  -- A revoked device only comes back through a new sign-in. The session that
  -- is asking is older than the revoke (or already deleted) when this is a
  -- phone that was signed out from elsewhere and has not noticed yet.
  IF v_revoked_at IS NOT NULL THEN
    BEGIN
      v_sid := NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_sid := NULL;
    END;
    IF v_sid IS NOT NULL AND to_regclass('auth.sessions') IS NOT NULL THEN
      EXECUTE 'SELECT created_at FROM auth.sessions WHERE id = $1' INTO v_session_at USING v_sid;
      IF v_session_at IS NULL OR v_session_at < v_revoked_at THEN
        RETURN jsonb_build_object(
          'tier', v_tier,
          'limit', public.waves_device_cap(v_profile, v_tier = 'plus'),
          'activeCount', 0,
          'overLimit', false,
          'firstSighting', false,
          'revoked', true
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.device_sessions
    (profile_id, device_id, label, platform, app_version, last_seen_at, revoked_at)
  VALUES
    (v_profile, p_device_id, v_label, v_platform, p_app_version, now(), NULL)
  ON CONFLICT (profile_id, device_id) DO UPDATE
    SET label        = EXCLUDED.label,
        platform     = EXCLUDED.platform,
        app_version  = EXCLUDED.app_version,
        last_seen_at = now(),
        revoked_at   = NULL;

  IF v_fresh AND NOT public.waves_is_guest(v_profile) THEN
    PERFORM public.waves_notify(
      v_profile,
      NULL,
      'new_device_login',
      'New sign-in on ' || v_label,
      'If this was not you, sign that device out and change how you sign in.',
      'waves://settings/devices',
      jsonb_build_object('device', v_label || ' · ' || v_platform),
      'new_device:' || v_profile::text || ':' || p_device_id || ':' || current_date::text
    );
  END IF;

  v_limit := public.waves_device_cap(v_profile, v_tier = 'plus');

  SELECT count(*) INTO v_active
  FROM public.device_sessions
  WHERE profile_id = v_profile
    AND revoked_at IS NULL
    AND last_seen_at > now() - interval '14 days';

  RETURN jsonb_build_object(
    'tier', v_tier,
    'limit', v_limit,
    'activeCount', v_active,
    'overLimit', v_active > v_limit,
    'firstSighting', NOT v_known,
    'revoked', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_register_device(p_device_id text, p_label text, p_platform text, p_app_version text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_register_device(p_device_id text, p_label text, p_platform text, p_app_version text) TO authenticated;

CREATE OR REPLACE FUNCTION public.waves_sign_out_other_devices(p_device_id text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_count   int;
  v_sid     uuid;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: only a signed-in account has devices'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.device_sessions
  SET revoked_at = now()
  WHERE profile_id = v_profile
    AND device_id <> p_device_id
    AND revoked_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- End the other GoTrue sessions too (refresh tokens cascade), keeping the
  -- one that is asking. Only when the caller's session is known: deleting
  -- "everything but an unknown session" would sign this phone out as well.
  BEGIN
    v_sid := NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_sid := NULL;
  END;
  IF v_sid IS NOT NULL AND to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1 AND id <> $2' USING v_profile, v_sid;
  END IF;

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.waves_sign_out_other_devices(p_device_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_sign_out_other_devices(p_device_id text) TO authenticated;
