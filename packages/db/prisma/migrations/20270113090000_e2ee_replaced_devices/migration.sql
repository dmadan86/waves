-- A device is inactive when unseen for 30 days, or unseen for 3 days while a NEWER device of the
-- same profile has been seen in the last 3 days (a reinstall leaves the old id behind). Inactive
-- devices are not addressed and their queued mail is purged; the row stays, and the phone
-- becomes live again (and resyncs) when it calls waves_device_seen.

CREATE FUNCTION public.waves_e2ee_device_inactive(p_profile uuid, p_created timestamptz, p_seen timestamptz)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT p_seen < now() - interval '30 days'
      OR (p_seen < now() - interval '3 days'
          AND EXISTS (SELECT 1 FROM public.e2ee_devices s
                       WHERE s.profile_id = p_profile AND s.created_at > p_created
                         AND s.last_seen_at >= now() - interval '3 days'));
$$;

CREATE OR REPLACE FUNCTION public.waves_device_seen(p_device_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_created timestamptz;
  v_seen timestamptz;
  v_was boolean;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT created_at, last_seen_at INTO v_created, v_seen FROM public.e2ee_devices
   WHERE id = p_device_id AND profile_id = v_profile FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_was := public.waves_e2ee_device_inactive(v_profile, v_created, v_seen);
  UPDATE public.e2ee_devices SET last_seen_at = now() WHERE id = p_device_id;
  -- Mail queued for this profile's other, now replaced devices will never be read.
  DELETE FROM public.group_mailbox mb USING public.e2ee_devices d
   WHERE mb.recipient_device_id = d.id AND d.profile_id = v_profile AND d.id <> p_device_id
     AND public.waves_e2ee_device_inactive(d.profile_id, d.created_at, d.last_seen_at);
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
     AND NOT public.waves_e2ee_device_inactive(d.profile_id, d.created_at, d.last_seen_at);
END
$$;

CREATE OR REPLACE FUNCTION public.waves_mailbox_skip_stale() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.e2ee_devices d
              WHERE d.id = NEW.recipient_device_id
                AND public.waves_e2ee_device_inactive(d.profile_id, d.created_at, d.last_seen_at)) THEN
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
     AND public.waves_e2ee_device_inactive(d.profile_id, d.created_at, d.last_seen_at);
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  DELETE FROM public.group_mailbox_receipts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  RETURN v_n + v_stale + v_receipts;
END
$$;

REVOKE ALL ON FUNCTION public.waves_e2ee_device_inactive(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_e2ee_device_inactive(uuid, timestamptz, timestamptz) TO service_role;
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
