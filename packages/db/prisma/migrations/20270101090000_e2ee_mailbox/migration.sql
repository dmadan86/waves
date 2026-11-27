-- End-to-end encrypted couple/home rentals: the server is a mailbox.
--
-- Rental records live only on the partners' phones. Each phone registers a
-- public key (`e2ee_devices`); to share a change, a phone encrypts it once per
-- recipient device and drops the ciphertext in `group_mailbox` through
-- `waves_mailbox_send`. The recipient applies it and DELETEs the row (that is
-- the ack). Rows nobody collected are purged after 30 days. The server never
-- reads content.
--
-- What the server still sees: which profiles are in the group, each device's
-- public key, who sent to whom and when, the ciphertext size, and (for the
-- 'rent_recorded' hint only) that the sender recorded rent. Never an amount.
--
-- This retires the plaintext `group_records` table from 20261231090000 (empty
-- in production). Deploy order: sync function first, then this migration.

-- ─────────────────────────────────────────────────── retire group_records ──

DROP TRIGGER IF EXISTS group_records_guard ON public.group_records;
DROP TRIGGER IF EXISTS group_records_stamp_seq ON public.group_records;
DROP TRIGGER IF EXISTS group_records_rent_notify ON public.group_records;
DROP TRIGGER IF EXISTS group_members_copy_group_records ON public.group_members;
DROP TRIGGER IF EXISTS groups_copy_group_records ON public.groups;
DROP FUNCTION IF EXISTS public.waves_group_records_guard();
DROP FUNCTION IF EXISTS public.waves_group_records_rent_notify();
DROP FUNCTION IF EXISTS public.waves_copy_group_records_to_personal(uuid, uuid);
DROP FUNCTION IF EXISTS public.waves_group_records_member_left();
DROP FUNCTION IF EXISTS public.waves_group_records_group_deleted();
DROP TABLE IF EXISTS public.group_records;

-- ───────────────────────────────────────────────────────────── e2ee_devices ──

CREATE TABLE public.e2ee_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    public_key bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT e2ee_devices_pkey PRIMARY KEY (id),
    CONSTRAINT e2ee_devices_key_len CHECK (octet_length(public_key) = 32),
    CONSTRAINT e2ee_devices_profile_key_unique UNIQUE (profile_id, public_key),
    CONSTRAINT e2ee_devices_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE
);

ALTER TABLE public.e2ee_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY e2ee_devices_select_own ON public.e2ee_devices
  FOR SELECT TO authenticated USING (profile_id = public.waves_current_profile_id());

REVOKE ALL ON TABLE public.e2ee_devices FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.e2ee_devices TO authenticated;
GRANT ALL ON TABLE public.e2ee_devices TO service_role;

-- ──────────────────────────────────────────────────────────── group_mailbox ──

CREATE TABLE public.group_mailbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    sender_device_id uuid,
    recipient_device_id uuid NOT NULL,
    ciphertext bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT group_mailbox_pkey PRIMARY KEY (id),
    CONSTRAINT group_mailbox_size CHECK (octet_length(ciphertext) <= 65536),
    CONSTRAINT group_mailbox_group_id_fkey FOREIGN KEY (group_id)
      REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT group_mailbox_sender_fkey FOREIGN KEY (sender_device_id)
      REFERENCES public.e2ee_devices(id) ON DELETE SET NULL,
    CONSTRAINT group_mailbox_recipient_fkey FOREIGN KEY (recipient_device_id)
      REFERENCES public.e2ee_devices(id) ON DELETE CASCADE
);

CREATE INDEX group_mailbox_recipient_created_idx
  ON public.group_mailbox USING btree (recipient_device_id, created_at);
CREATE INDEX group_mailbox_group_id_idx ON public.group_mailbox USING btree (group_id);
CREATE INDEX group_mailbox_sender_idx ON public.group_mailbox USING btree (sender_device_id);

ALTER TABLE public.group_mailbox ENABLE ROW LEVEL SECURITY;

-- Inline subquery: RLS on e2ee_devices already limits it to the caller's own.
CREATE POLICY group_mailbox_select_own ON public.group_mailbox
  FOR SELECT TO authenticated
  USING (recipient_device_id IN (SELECT id FROM public.e2ee_devices));
CREATE POLICY group_mailbox_delete_own ON public.group_mailbox
  FOR DELETE TO authenticated
  USING (recipient_device_id IN (SELECT id FROM public.e2ee_devices));

REVOKE ALL ON TABLE public.group_mailbox FROM PUBLIC, anon;
GRANT SELECT, DELETE ON TABLE public.group_mailbox TO authenticated;
GRANT ALL ON TABLE public.group_mailbox TO service_role;

-- ───────────────────────────────────────────────────────────────────── RPCs ──

CREATE FUNCTION public.waves_register_device(p_public_key bytea) RETURNS uuid
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
  INSERT INTO public.e2ee_devices (profile_id, public_key)
  VALUES (v_profile, p_public_key)
  ON CONFLICT (profile_id, public_key) DO UPDATE SET last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE FUNCTION public.waves_remove_device(p_device_id uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  DELETE FROM public.e2ee_devices
   WHERE id = p_device_id AND profile_id = public.waves_current_profile_id();
$$;

CREATE FUNCTION public.waves_group_devices(p_group_id uuid)
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
   WHERE m.group_id = p_group_id AND m.left_at IS NULL AND m.removed_at IS NULL;
END
$$;

CREATE FUNCTION public.waves_mailbox_send(
  p_group_id uuid, p_sender_device uuid, p_items jsonb, p_hint text DEFAULT NULL
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_n integer;
  v_expected integer;
  v_limit jsonb;
  v_actor text;
  v_group_name text;
  v_key text;
  v_new boolean := false;
  v_recips uuid[];
  v_cts bytea[];
  r record;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.e2ee_devices WHERE id = p_sender_device AND profile_id = v_profile) THEN
    RAISE EXCEPTION 'Unknown sender device' USING ERRCODE = '42501';
  END IF;
  IF NOT public.waves_can_use_group_records(p_group_id) THEN
    RAISE EXCEPTION 'Not a member of this group' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_items);
  IF v_n > 200 THEN
    RAISE EXCEPTION 'Too many items in one call' USING ERRCODE = '54000';
  END IF;

  v_limit := public.waves_rate_limit('mailbox:' || v_profile::text, 'mailbox-send', 120, 60);
  IF NOT (v_limit->>'allowed')::boolean THEN
    RAISE EXCEPTION 'Slow down' USING ERRCODE = '54000';
  END IF;

  BEGIN
    SELECT array_agg((i->>'recipient_device')::uuid), array_agg(decode(i->>'ciphertext', 'base64'))
      INTO v_recips, v_cts
      FROM jsonb_array_elements(p_items) AS i;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Malformed item' USING ERRCODE = '22023';
  END;
  IF v_n = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_recips, v_cts) AS t(recipient, ct)
              WHERE recipient IS NULL OR ct IS NULL OR octet_length(ct) > 65536) THEN
    RAISE EXCEPTION 'Bad item or ciphertext over 64 KB' USING ERRCODE = '22023';
  END IF;

  -- Every recipient must be a device of a live member of this group.
  SELECT count(*) INTO v_expected
    FROM unnest(v_recips) AS t(recipient)
   WHERE EXISTS (
     SELECT 1 FROM public.e2ee_devices d
       JOIN public.group_members m ON m.profile_id = d.profile_id
      WHERE d.id = t.recipient AND m.group_id = p_group_id
        AND m.left_at IS NULL AND m.removed_at IS NULL);
  IF v_expected <> v_n THEN
    RAISE EXCEPTION 'A recipient is not in this group' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.group_mailbox (group_id, sender_device_id, recipient_device_id, ciphertext)
  SELECT p_group_id, p_sender_device, recipient, ct FROM unnest(v_recips, v_cts) AS t(recipient, ct);

  IF p_hint = 'rent_recorded' THEN
    SELECT COALESCE(NULLIF(display_name, ''), 'Someone') INTO v_actor FROM public.profiles WHERE id = v_profile;
    SELECT name INTO v_group_name FROM public.groups WHERE id = p_group_id;
    v_key := md5(p_items::text);
    FOR r IN
      SELECT DISTINCT m.profile_id FROM public.group_members m
       WHERE m.group_id = p_group_id AND m.profile_id IS NOT NULL
         AND m.left_at IS NULL AND m.removed_at IS NULL AND m.profile_id <> v_profile
    LOOP
      IF public.waves_notify(
           r.profile_id, p_group_id, 'rent_recorded',
           COALESCE(v_actor, 'Someone') || ' recorded rent received',
           COALESCE(v_group_name, ''),
           'waves://group/' || p_group_id::text,
           jsonb_build_object('counterparty', COALESCE(v_actor, 'Someone'), 'group', COALESCE(v_group_name, '')),
           'rent_recorded:' || p_group_id::text || ':' || v_key || ':' || r.profile_id::text) IS NOT NULL THEN
        v_new := true;
      END IF;
    END LOOP;
    -- One content-free activity row, only when this send was not a retry.
    IF v_new THEN
      INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, payload)
      VALUES (p_group_id, public.waves_my_member_id(p_group_id), 'rent_recorded', 'group', '{}'::jsonb);
    END IF;
  END IF;
  RETURN v_n;
END
$$;

-- ───────────────────────────────────────── leaving drops the leaver's mail ──

CREATE FUNCTION public.waves_mailbox_member_left() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  DELETE FROM public.group_mailbox mb
   USING public.e2ee_devices d
   WHERE mb.group_id = NEW.group_id AND mb.recipient_device_id = d.id
     AND d.profile_id = NEW.profile_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER group_members_mailbox_cleanup AFTER UPDATE OF left_at, removed_at ON public.group_members
  FOR EACH ROW
  WHEN (NEW.profile_id IS NOT NULL
        AND ((OLD.left_at IS NULL AND NEW.left_at IS NOT NULL)
          OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL)))
  EXECUTE FUNCTION public.waves_mailbox_member_left();

-- ─────────────────────────────────────────────────────────────── 30-day purge ──

CREATE FUNCTION public.waves_purge_mailbox() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.group_mailbox WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('waves-purge-mailbox')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waves-purge-mailbox');
    PERFORM cron.schedule('waves-purge-mailbox', '40 3 * * *', $cron$SELECT public.waves_purge_mailbox();$cron$);
  END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────── grants ──

REVOKE ALL ON FUNCTION public.waves_register_device(bytea) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_register_device(bytea) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_remove_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_remove_device(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_devices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_devices(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_mailbox_send(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_mailbox_send(uuid, uuid, jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_mailbox_member_left() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_mailbox_member_left() TO service_role;
REVOKE ALL ON FUNCTION public.waves_purge_mailbox() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_purge_mailbox() TO service_role;
