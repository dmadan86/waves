-- A device is replaced only explicitly: the same install registered a new device id and said so
-- (waves_replace_device). Everything else keeps the 30-day stale rule, so a real second device
-- (a tablet used weekly) is never dropped. Replaced devices are not addressed and their queued
-- mail is purged; the row stays, and the phone becomes live again (and resyncs) when it calls
-- waves_device_seen.

ALTER TABLE public.e2ee_devices ADD COLUMN replaced_at timestamptz;

CREATE FUNCTION public.waves_e2ee_device_inactive(p_replaced timestamptz, p_seen timestamptz)
    RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT p_replaced IS NOT NULL OR p_seen < now() - interval '30 days';
$$;

CREATE FUNCTION public.waves_replace_device(p_old uuid, p_new uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_old IS NULL OR p_new IS NULL OR p_old = p_new THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.e2ee_devices WHERE id = p_new AND profile_id = v_profile) THEN
    RAISE EXCEPTION 'Unknown device' USING ERRCODE = '42501';
  END IF;
  UPDATE public.e2ee_devices SET replaced_at = now()
   WHERE id = p_old AND profile_id = v_profile AND replaced_at IS NULL;
  DELETE FROM public.group_mailbox mb USING public.e2ee_devices d
   WHERE mb.recipient_device_id = d.id AND d.id = p_old AND d.profile_id = v_profile;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_device_seen(p_device_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_replaced timestamptz;
  v_seen timestamptz;
  v_was boolean;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT replaced_at, last_seen_at INTO v_replaced, v_seen FROM public.e2ee_devices
   WHERE id = p_device_id AND profile_id = v_profile FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_was := public.waves_e2ee_device_inactive(v_replaced, v_seen);
  UPDATE public.e2ee_devices SET last_seen_at = now(), replaced_at = NULL WHERE id = p_device_id;
  RETURN v_was;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_group_devices(p_group_id uuid)
    RETURNS TABLE(device_id uuid, member_id uuid, profile_id uuid, public_key bytea)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.waves_can_use_group_records(p_group_id) THEN
    RAISE EXCEPTION 'Not a member of this group' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id, m.id, d.profile_id, d.public_key
    FROM public.group_members m
    JOIN public.e2ee_devices d ON d.profile_id = m.profile_id
   WHERE m.group_id = p_group_id AND m.left_at IS NULL AND m.removed_at IS NULL
     AND NOT public.waves_e2ee_device_inactive(d.replaced_at, d.last_seen_at);
END
$$;

CREATE OR REPLACE FUNCTION public.waves_mailbox_skip_stale() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.e2ee_devices d
              WHERE d.id = NEW.recipient_device_id
                AND public.waves_e2ee_device_inactive(d.replaced_at, d.last_seen_at)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_purge_mailbox() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_n integer;
  v_stale integer;
  v_receipts integer;
BEGIN
  DELETE FROM public.group_mailbox WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.group_mailbox mb USING public.e2ee_devices d
   WHERE d.id = mb.recipient_device_id
     AND public.waves_e2ee_device_inactive(d.replaced_at, d.last_seen_at);
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  DELETE FROM public.group_mailbox_receipts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  RETURN v_n + v_stale + v_receipts;
END
$$;

REVOKE ALL ON FUNCTION public.waves_e2ee_device_inactive(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_e2ee_device_inactive(timestamptz, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.waves_replace_device(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_replace_device(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_device_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_device_seen(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_devices(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_mailbox_skip_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_mailbox_skip_stale() TO service_role;
REVOKE ALL ON FUNCTION public.waves_purge_mailbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_purge_mailbox() TO service_role;

-- Clear what has already piled up for replaced devices.
SELECT public.waves_purge_mailbox();
