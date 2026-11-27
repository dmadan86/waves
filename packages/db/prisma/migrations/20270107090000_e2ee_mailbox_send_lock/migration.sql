CREATE OR REPLACE FUNCTION public.waves_mailbox_send(
  p_group_id uuid, p_sender_device uuid, p_items jsonb, p_hint text DEFAULT NULL, p_event_id text DEFAULT NULL
) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_n integer;
  v_bytes bigint;
  v_i integer;
  v_charge integer;
  v_expected integer;
  v_limit jsonb;
  v_actor text;
  v_group_name text;
  v_key text;
  v_new boolean := false;
  v_recips uuid[];
  v_cts bytea[];
  v_delivery_ids uuid[];
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
    SELECT array_agg((i->>'recipient_device')::uuid), array_agg(decode(i->>'ciphertext', 'base64')),
           array_agg(NULLIF(i->>'delivery_id', '')::uuid)
      INTO v_recips, v_cts, v_delivery_ids
      FROM jsonb_array_elements(p_items) AS i;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Malformed item' USING ERRCODE = '22023';
  END;
  IF v_n = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_recips) AS t(recipient) GROUP BY recipient HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'DUPLICATE_RECIPIENT_DEVICE: recipient device ids must be unique per call' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(octet_length(ct)), 0) INTO v_bytes FROM unnest(v_cts) AS t(ct);
  IF v_bytes > 524288 THEN
    RAISE EXCEPTION 'CALL_BYTES_LIMIT_EXCEEDED: total ciphertext bytes exceed 512 KiB' USING ERRCODE = '54000';
  END IF;
  -- Charge every envelope and every 4 KiB of ciphertext against independent per-minute buckets.
  FOR v_i IN 1..v_n LOOP
    v_limit := public.waves_rate_limit('mailbox:' || v_profile::text, 'mailbox-envelope', 24000, 60);
    IF NOT (v_limit->>'allowed')::boolean THEN RAISE EXCEPTION 'ENVELOPE_RATE_LIMIT_EXCEEDED: slow down' USING ERRCODE = '54000'; END IF;
  END LOOP;
  v_charge := ceil(v_bytes::numeric / 4096)::integer;
  FOR v_i IN 1..v_charge LOOP
    v_limit := public.waves_rate_limit('mailbox:' || v_profile::text, 'mailbox-bytes', 8192, 60);
    IF NOT (v_limit->>'allowed')::boolean THEN RAISE EXCEPTION 'BYTE_RATE_LIMIT_EXCEEDED: slow down' USING ERRCODE = '54000'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(v_recips, v_cts) AS t(recipient, ct)
              WHERE recipient IS NULL OR ct IS NULL OR octet_length(ct) > 65536) THEN
    RAISE EXCEPTION 'Bad item or ciphertext over 64 KB' USING ERRCODE = '22023';
  END IF;

  -- Lock live recipient membership rows so concurrent removal cleanup cannot race the insert.
  PERFORM 1
    FROM public.group_members m
    JOIN (SELECT DISTINCT d.profile_id
            FROM public.e2ee_devices d
           WHERE d.id = ANY(v_recips)) recipients ON recipients.profile_id = m.profile_id
   WHERE m.group_id = p_group_id
     AND m.left_at IS NULL AND m.removed_at IS NULL
   FOR SHARE OF m;

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

  PERFORM pg_advisory_xact_lock(hashtextextended('e2ee-mailbox-profile:' || v_profile::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('e2ee-mailbox-recipient:' || recipient::text, 0))
    FROM (SELECT DISTINCT unnest(v_recips) AS recipient ORDER BY 1) recipients;
  IF EXISTS (
    SELECT 1 FROM (SELECT recipient, sum(octet_length(ct)) bytes FROM unnest(v_recips, v_cts, v_delivery_ids) AS t(recipient, ct, delivery_id)
      WHERE delivery_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.group_mailbox_receipts rcp WHERE rcp.sender_device_id = p_sender_device AND rcp.delivery_id = t.delivery_id) GROUP BY recipient) incoming
    WHERE (SELECT COALESCE(sum(octet_length(m.ciphertext)), 0) FROM public.group_mailbox m WHERE m.recipient_device_id = incoming.recipient) + incoming.bytes > 8388608
  ) THEN RAISE EXCEPTION 'RECIPIENT_MAILBOX_BYTES_LIMIT_EXCEEDED: recipient mailbox is full' USING ERRCODE = '54000'; END IF;
  IF (SELECT COALESCE(sum(octet_length(m.ciphertext)), 0) FROM public.group_mailbox m WHERE m.sender_profile_id = v_profile)
     + (SELECT COALESCE(sum(octet_length(ct)), 0) FROM unnest(v_cts, v_delivery_ids) AS t(ct, delivery_id)
        WHERE delivery_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.group_mailbox_receipts rcp WHERE rcp.sender_device_id = p_sender_device AND rcp.delivery_id = t.delivery_id)) > 33554432 THEN
    RAISE EXCEPTION 'SENDER_PROFILE_MAILBOX_BYTES_LIMIT_EXCEEDED: sender profile mailbox quota exceeded' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.group_mailbox (group_id, sender_device_id, sender_profile_id, recipient_device_id, ciphertext, delivery_id)
  SELECT p_group_id, p_sender_device, v_profile, recipient, ct, delivery_id
    FROM unnest(v_recips, v_cts, v_delivery_ids) AS t(recipient, ct, delivery_id)
   WHERE delivery_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.group_mailbox_receipts rcp WHERE rcp.sender_device_id = p_sender_device AND rcp.delivery_id = t.delivery_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_expected = ROW_COUNT;

  INSERT INTO public.group_mailbox_receipts(sender_device_id, delivery_id, sender_profile_id)
  SELECT p_sender_device, delivery_id, v_profile FROM unnest(v_delivery_ids) AS t(delivery_id)
  WHERE delivery_id IS NOT NULL ON CONFLICT DO NOTHING;

  IF p_hint = 'rent_recorded' THEN
    SELECT COALESCE(NULLIF(display_name, ''), 'Someone') INTO v_actor FROM public.profiles WHERE id = v_profile;
    SELECT name INTO v_group_name FROM public.groups WHERE id = p_group_id;
    v_key := CASE WHEN p_event_id IS NOT NULL THEN md5(p_group_id::text || ':' || p_event_id) ELSE md5(p_items::text) END;
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
  RETURN v_expected;
END
$$;

REVOKE ALL ON FUNCTION public.waves_mailbox_send(uuid, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_mailbox_send(uuid, uuid, jsonb, text, text) TO authenticated, service_role;
