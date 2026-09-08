-- Something to look at while the bill is still being fetched.
--
-- A receipt's bytes live behind a short-lived signed URL in a private bucket,
-- so the first sight of one on a device that has not cached it is a network
-- round trip: mint the URL, then download a picture sized for OCR. Until both
-- finish the tile is an empty grey square — and the row describing the receipt
-- arrived from the mirror long before, so the app knows a picture is coming and
-- has nothing to say about it.
--
-- This is the standard answer: a thumbnail small enough to travel inside the row
-- itself. The client encodes the receipt down to roughly 32 pixels on its long
-- edge and stores it here as a `data:` URI — a kilobyte or so, which is cheaper
-- than the request that would fetch it separately, and therefore only worth
-- keeping at a size where that stays true. Upscaled to tile or full-screen it is
-- a soft wash of the real image's colours, drawn the instant the row is read and
-- cross-faded out when the real bytes land.
--
-- It is decoration, and the column treats it as such: the writers below drop
-- anything that is not a small image data URI rather than refuse the upload. A
-- receipt with no preview is exactly what every receipt already stored has, and
-- it renders the way it renders today.

ALTER TABLE public.expense_attachments
  ADD COLUMN preview text;

COMMENT ON COLUMN public.expense_attachments.preview IS
  'A tiny blurred stand-in for the image, as a data: URI, drawn while the real bytes load. Decoration — null is normal.';

-- The ceiling is the point of the thing: a preview that is not far smaller than
-- the request it saves has stopped being a preview. 4 KB is generous for a
-- 32px JPEG (they land near 1 KB) and small enough that a row carrying one is
-- still a row.
ALTER TABLE public.expense_attachments
  ADD CONSTRAINT expense_attachments_preview_small
  CHECK (preview IS NULL OR length(preview) <= 4096);

-- What counts as a preview, in one place.
--
-- Both writers below take the string from a client, and a client is not a
-- reason to trust it: a caller could put a novel in this field, or a `javascript:`
-- URI, and every device in the group would render whatever the row said. So the
-- shape is checked here — a small, self-contained image data URI and nothing
-- else — and anything failing the check becomes NULL rather than an error.
-- IMMUTABLE and STRICT-ish so it costs nothing to call on every write.
CREATE FUNCTION public.waves_clean_image_preview(p_preview text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN p_preview IS NULL THEN NULL
    WHEN length(p_preview) > 4096 THEN NULL
    WHEN p_preview ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' THEN p_preview
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.waves_clean_image_preview(text) IS
  'Accept a small image data URI as a loading placeholder, or NULL. Never raises — a bad preview is dropped, not a reason to fail a write.';

-- Only the two definer writers below call this, and they run as their owner, so
-- nobody signed in ever needs to reach it directly.
REVOKE ALL ON FUNCTION public.waves_clean_image_preview(p_preview text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_clean_image_preview(p_preview text) TO service_role;

-- ─────────────────────────────────────────────────────────── the two writers ──
--
-- Both are dropped and recreated rather than overloaded. A second signature
-- differing only by a defaulted trailing argument makes every existing
-- four-argument call ambiguous, and PostgREST resolves by name — so the app
-- would start getting "could not choose the best candidate function" for the
-- calls it has always made. One signature, with the new argument defaulted, is
-- both unambiguous and backwards compatible: a client built before this ships
-- omits it and stores no preview.

DROP FUNCTION IF EXISTS public.waves_attach_expense_attachment(uuid, text, text, uuid);

CREATE FUNCTION public.waves_attach_expense_attachment(p_expense_id uuid, p_storage_path text, p_visibility text DEFAULT 'group'::text, p_attachment_id uuid DEFAULT NULL::uuid, p_preview text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id uuid;
  v_member   uuid;
  v_id       uuid;
  v_preview  text;
BEGIN
  IF coalesce(btrim(p_storage_path), '') = '' THEN
    RAISE EXCEPTION 'INVALID_PATH: an attachment needs a stored image'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_visibility NOT IN ('group', 'parties') THEN
    RAISE EXCEPTION 'INVALID_VISIBILITY: group or parties' USING ERRCODE = 'check_violation';
  END IF;

  -- The key MUST be scoped to this expense: `<expenseId>/…` (see the proof RPC).
  IF p_storage_path NOT LIKE p_expense_id::text || '/%' THEN
    RAISE EXCEPTION 'INVALID_PATH: the key must be scoped to its expense'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A malformed or oversized preview is dropped, not refused. It is a loading
  -- placeholder; failing somebody's upload over one would trade a real receipt
  -- for a cosmetic detail.
  v_preview := public.waves_clean_image_preview(p_preview);

  -- Authorise before resolving the client id (an existence oracle otherwise).
  SELECT group_id INTO v_group_id FROM public.expenses WHERE id = p_expense_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such expense' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.waves_is_expense_party(p_expense_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTY: only a payer or the author may attach to this expense'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Replay bound to the subject: same id + same expense returns the existing row
  -- (and, because it returns here, never emits a second audit line and is never
  -- re-counted against the cap).
  IF p_attachment_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.expense_attachments
    WHERE id = p_attachment_id AND expense_id = p_expense_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  -- The bytes must really exist: a committed object at this key, in the
  -- attachments bucket. Blocks a phantom / never-uploaded / pending-only path
  -- from being recorded as an attachment. Checked for a genuinely new row only.
  PERFORM public.waves_require_committed_object('expense-attachments', btrim(p_storage_path));

  -- Serialize the count-then-insert against other attaches to THIS expense: a
  -- transaction-scoped advisory lock keyed on the expense id. Without it two
  -- concurrent adds could both read a live count below the cap and both insert,
  -- landing one over (the same race the ghost-merge path guards). Only other
  -- attach calls take this key, so it never blocks unrelated writers, and it is
  -- released at commit. Taken before the count so a paid group pays only a
  -- trivial, uncontended lock and nothing else.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expense_id::text, 0));

  -- The per-expense ceiling, enforced at the one insert path. A paid group is
  -- exempt; only live (non-deleted) attachments count, so removing one frees a
  -- slot.
  IF NOT public.waves_group_is_paid(v_group_id)
     AND (SELECT count(*) FROM public.expense_attachments
           WHERE expense_id = p_expense_id AND deleted_at IS NULL)
         >= public.waves_attachment_cap()
  THEN
    RAISE EXCEPTION 'ATTACHMENT_CAP'
      USING ERRCODE = 'check_violation',
            HINT = 'This expense has reached its free receipt limit; upgrade to add more.';
  END IF;

  v_member := public.waves_my_member_id(v_group_id);

  INSERT INTO public.expense_attachments
    (id, expense_id, group_id, uploader_member_id, storage_path, visibility, preview)
  VALUES
    (COALESCE(p_attachment_id, gen_random_uuid()), p_expense_id, v_group_id, v_member,
     btrim(p_storage_path), p_visibility, v_preview)
  RETURNING id INTO v_id;

  INSERT INTO public.expense_image_events
    (id, group_id, expense_id, actor_member_id, kind, action, visibility)
  VALUES
    (gen_random_uuid(), v_group_id, p_expense_id, v_member, 'attachment', 'added', p_visibility);

  RETURN v_id;
END
$$;

-- The dropped signature took its grants with it; put back the ones the baseline
-- and the authenticated-surface migration gave the four-argument form.
REVOKE ALL ON FUNCTION public.waves_attach_expense_attachment(p_expense_id uuid, p_storage_path text, p_visibility text, p_attachment_id uuid, p_preview text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_attach_expense_attachment(p_expense_id uuid, p_storage_path text, p_visibility text, p_attachment_id uuid, p_preview text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.waves_replace_expense_attachment_image(uuid, text);

CREATE FUNCTION public.waves_replace_expense_attachment_image(p_attachment_id uuid, p_new_path text, p_preview text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_expense_id uuid;
BEGIN
  IF coalesce(btrim(p_new_path), '') = '' THEN
    RAISE EXCEPTION 'INVALID_PATH: a replacement needs a stored image'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT expense_id INTO v_expense_id
  FROM public.expense_attachments
  WHERE id = p_attachment_id AND deleted_at IS NULL;
  IF v_expense_id IS NULL THEN
    RETURN;
  END IF;

  -- The new key MUST stay scoped to this expense, exactly like the attach RPC.
  IF p_new_path NOT LIKE v_expense_id::text || '/%' THEN
    RAISE EXCEPTION 'INVALID_PATH: the key must be scoped to its expense'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.waves_is_expense_party(v_expense_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTY: only a party may adjust this image'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The replacement bytes must really exist: a committed object at the new key.
  -- Without this the row could be repointed at a never-uploaded path, and the
  -- markup would be cleared, leaving the attachment pointing at nothing.
  PERFORM public.waves_require_committed_object('expense-attachments', btrim(p_new_path));

  -- The preview is overwritten, not merged: these are different pixels — a
  -- rotation or a crop — and the old thumbnail would flash the previous framing
  -- before the new image resolved. A caller that sends none leaves the row with
  -- no preview, which is honest.
  UPDATE public.expense_attachments
     SET storage_path = btrim(p_new_path),
         annotations  = NULL,
         preview      = public.waves_clean_image_preview(p_preview)
   WHERE id = p_attachment_id AND deleted_at IS NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_replace_expense_attachment_image(p_attachment_id uuid, p_new_path text, p_preview text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_replace_expense_attachment_image(p_attachment_id uuid, p_new_path text, p_preview text) TO authenticated, service_role;
