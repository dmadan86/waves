CREATE TABLE public.e2ee_revoked_keys (
  profile_id uuid NOT NULL,
  public_key bytea NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT e2ee_revoked_keys_pkey PRIMARY KEY (profile_id, public_key),
  CONSTRAINT e2ee_revoked_keys_profile_id_fkey FOREIGN KEY (profile_id)
    REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE public.e2ee_revoked_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.e2ee_revoked_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.e2ee_revoked_keys TO service_role;

CREATE OR REPLACE FUNCTION public.waves_register_device(p_public_key bytea) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_id uuid;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_public_key IS NULL OR octet_length(p_public_key) <> 32 THEN
    RAISE EXCEPTION 'A device key is 32 bytes' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('e2ee-device-profile:' || v_profile::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.e2ee_revoked_keys
     WHERE profile_id = v_profile AND public_key = p_public_key
  ) THEN
    RAISE EXCEPTION 'DEVICE_REVOKED: this key was removed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.e2ee_devices WHERE profile_id = v_profile AND public_key = p_public_key)
     AND (SELECT count(*) FROM public.e2ee_devices WHERE profile_id = v_profile) >= 10 THEN
    RAISE EXCEPTION 'DEVICE_LIMIT_REACHED: at most 10 devices may be registered' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.e2ee_devices (profile_id, public_key)
  VALUES (v_profile, p_public_key)
  ON CONFLICT (profile_id, public_key) DO UPDATE SET last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_remove_device(p_device_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('e2ee-device-profile:' || v_profile::text, 0));
  INSERT INTO public.e2ee_revoked_keys (profile_id, public_key)
  SELECT profile_id, public_key FROM public.e2ee_devices
   WHERE id = p_device_id AND profile_id = v_profile
  ON CONFLICT (profile_id, public_key) DO NOTHING;
  DELETE FROM public.e2ee_devices
   WHERE id = p_device_id AND profile_id = v_profile;
END
$$;

REVOKE ALL ON FUNCTION public.waves_register_device(bytea) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_register_device(bytea) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_remove_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_remove_device(uuid) TO authenticated, service_role;
