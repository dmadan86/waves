-- A device not seen for 30 days is inactive: new mail is no longer addressed to it and its
-- queued mail is purged, so rows stop piling up for phones that never come back. The device
-- row stays (its key and id are still valid). When the phone returns it calls
-- waves_device_seen, becomes live again, and is told it was stale so it asks for a snapshot.

CREATE FUNCTION public.waves_device_seen(p_device_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_seen timestamptz;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT last_seen_at INTO v_seen FROM public.e2ee_devices
   WHERE id = p_device_id AND profile_id = v_profile FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE public.e2ee_devices SET last_seen_at = now() WHERE id = p_device_id;
  RETURN v_seen < now() - interval '30 days';
END
$$;

-- The directory the app seals to: live devices only.
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
     AND d.last_seen_at >= now() - interval '30 days';
END
$$;

-- A send racing a stale device (cached directory) drops the row instead of failing the batch.
CREATE FUNCTION public.waves_mailbox_skip_stale() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.e2ee_devices d
              WHERE d.id = NEW.recipient_device_id AND d.last_seen_at < now() - interval '30 days') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER group_mailbox_skip_stale BEFORE INSERT ON public.group_mailbox
  FOR EACH ROW EXECUTE FUNCTION public.waves_mailbox_skip_stale();

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
   WHERE d.id = mb.recipient_device_id AND d.last_seen_at < now() - interval '30 days';
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  DELETE FROM public.group_mailbox_receipts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  RETURN v_n + v_stale + v_receipts;
END
$$;

REVOKE ALL ON FUNCTION public.waves_device_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_device_seen(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_devices(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_mailbox_skip_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_mailbox_skip_stale() TO service_role;
REVOKE ALL ON FUNCTION public.waves_purge_mailbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_purge_mailbox() TO service_role;

-- Clear what has already piled up for devices that are already stale.
SELECT public.waves_purge_mailbox();
