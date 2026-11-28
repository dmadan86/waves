-- A device the account has plainly moved off is not addressed: idle for 14 days while another
-- device of the same account was seen within the last 14 days. A device that is merely offline
-- (nothing newer for its account) is kept until the old 30-day rule. It loses nothing when
-- skipped: waves_device_seen reports it as stale on return, so it asks for a snapshot.

CREATE FUNCTION public.waves_e2ee_device_gone(p_device uuid) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE((
    SELECT public.waves_e2ee_device_inactive(d.replaced_at, d.last_seen_at)
        OR (d.last_seen_at < now() - interval '14 days'
            AND EXISTS (SELECT 1 FROM public.e2ee_devices n
                         WHERE n.profile_id = d.profile_id AND n.id <> d.id
                           AND n.replaced_at IS NULL
                           AND n.last_seen_at > now() - interval '14 days'))
      FROM public.e2ee_devices d WHERE d.id = p_device
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.waves_device_seen(p_device_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_was boolean;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.e2ee_devices WHERE id = p_device_id AND profile_id = v_profile FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_was := public.waves_e2ee_device_gone(p_device_id);
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
     AND NOT public.waves_e2ee_device_gone(d.id);
END
$$;

CREATE OR REPLACE FUNCTION public.waves_mailbox_skip_stale() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF public.waves_e2ee_device_gone(NEW.recipient_device_id) THEN
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
  DELETE FROM public.group_mailbox mb
   WHERE public.waves_e2ee_device_gone(mb.recipient_device_id);
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  DELETE FROM public.group_mailbox_receipts WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_receipts = ROW_COUNT;
  RETURN v_n + v_stale + v_receipts;
END
$$;

REVOKE ALL ON FUNCTION public.waves_e2ee_device_gone(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_e2ee_device_gone(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_device_seen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_device_seen(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_devices(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_mailbox_skip_stale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_mailbox_skip_stale() TO service_role;
REVOKE ALL ON FUNCTION public.waves_purge_mailbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_purge_mailbox() TO service_role;
