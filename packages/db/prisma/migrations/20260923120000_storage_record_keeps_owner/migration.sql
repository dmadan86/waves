-- A replacement no longer takes over the image it replaces.
--
-- `r2-sign` now lets only an image's uploader, or a group admin, replace a
-- group receipt or album photo, and it knows who the uploader is from
-- `storage_objects.owner_profile_id`. `waves_storage_record` rewrote that column
-- on every commit (`ON CONFLICT … SET owner_profile_id = excluded…`), so the
-- first time an admin replaced a member's bill the admin became its "uploader":
-- the member who kept it lost the right to change it, and the admin's free
-- storage ceiling was charged for somebody else's receipt.
--
-- Now a commit onto an already-committed row keeps its owner, and `counted` is
-- recomputed for that owner (their plan decides whether it counts, not the
-- replacer's). A commit onto a pending row — an upload still in flight, which
-- no one has committed yet — takes the committing uploader as before.
--
-- Everything else is unchanged from the baseline definition: same signature,
-- same lock, same cap rule (a replacement of a committed object is recorded
-- even over the cap; only a brand-new object is refused).

CREATE OR REPLACE FUNCTION public.waves_storage_record(
  p_profile_id uuid,
  p_group_id uuid,
  p_logical_bucket text,
  p_path text,
  p_bytes bigint,
  p_content_type text DEFAULT 'image/webp'::text
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_counted boolean;
  v_used    bigint;
BEGIN
  IF p_profile_id IS NULL OR p_bytes IS NULL OR p_bytes < 0 THEN
    RAISE EXCEPTION 'STORAGE_BAD_INPUT' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 0));

  v_counted := public.waves_storage_counts(p_profile_id, p_group_id);

  IF v_counted THEN
    -- The true-size cap check, excluding this same object so a replacement
    -- measures the delta, not double.
    SELECT COALESCE(SUM(bytes), 0) INTO v_used
      FROM public.storage_objects
     WHERE owner_profile_id = p_profile_id
       AND counted
       AND NOT (logical_bucket = p_logical_bucket AND path = p_path);

    -- Reject only a *new* object over the ceiling. A replacement of an object
    -- already committed at this path is recorded honestly even if its true size
    -- lands over the cap (see the baseline for the reasoning).
    IF v_used + p_bytes > public.waves_free_storage_cap()
       AND NOT EXISTS (
         SELECT 1 FROM public.storage_objects
          WHERE logical_bucket = p_logical_bucket AND path = p_path AND NOT pending
       )
    THEN
      RAISE EXCEPTION 'STORAGE_CAP'
        USING ERRCODE = 'check_violation',
              HINT = 'You have reached your free storage limit; upgrade to add more.';
    END IF;
  END IF;

  INSERT INTO public.storage_objects
    (logical_bucket, path, owner_profile_id, group_id, bytes, content_type, counted, pending)
  VALUES
    (p_logical_bucket, p_path, p_profile_id, p_group_id, p_bytes, p_content_type, v_counted, false)
  ON CONFLICT (logical_bucket, path) DO UPDATE
    SET owner_profile_id = CASE
                             WHEN storage_objects.pending THEN excluded.owner_profile_id
                             ELSE storage_objects.owner_profile_id
                           END,
        group_id         = excluded.group_id,
        bytes            = excluded.bytes,
        content_type     = excluded.content_type,
        counted          = CASE
                             WHEN storage_objects.pending THEN excluded.counted
                             ELSE public.waves_storage_counts(
                                    storage_objects.owner_profile_id, excluded.group_id)
                           END,
        pending          = false,
        updated_at       = now();
END
$$;

-- Unchanged caller model: the edge function's service role only. CREATE OR
-- REPLACE keeps the existing ACL, but it is restated so this file stands alone.
REVOKE ALL ON FUNCTION public.waves_storage_record(uuid, uuid, text, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.waves_storage_record(uuid, uuid, text, text, bigint, text)
  TO service_role;
