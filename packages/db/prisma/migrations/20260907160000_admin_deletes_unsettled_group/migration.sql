-- An admin may delete their own group even when it is not settled.
--
-- `waves_delete_group` (A49) has enforced two conditions since it was written:
-- the caller must be an admin of the group, and the group must be square in
-- every currency. The second one turns out to be the wrong rule. A group whose
-- balances never reach zero — the trip nobody bothered to settle, the flatmates
-- who squared up in cash and never told the app, the group created by mistake
-- with one test expense in it — could not be deleted by anybody, ever, not even
-- by the person who created it. The refusal had no escape hatch: settling is
-- exactly the thing those people are not going to do.
--
-- So the settled check goes and the admin check stays. Whether the group is
-- square is a question for the people in it, not a lock on the door; whether
-- the caller is an admin is still the only thing standing between one member
-- and everyone else's copy of the group.
--
-- The consequence is real and is why the clients now say it out loud before
-- they call this: deleting an unsettled group destroys the record of who owed
-- whom for every member, not just for the one who tapped the button. That
-- warning is a UI responsibility. The database's job here is to stop refusing.
--
-- Everything else about the function is unchanged — same signature, same void
-- return (so `CREATE OR REPLACE` is enough and there is no 42P13 return-type
-- conflict to drop around), same `FOR UPDATE` lock, same idempotent re-delete,
-- and the delete is still a tombstone on `groups.deleted_at` rather than a row
-- delete, because ADR-004 keeps the ledger append-only.

CREATE OR REPLACE FUNCTION public.waves_delete_group(p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_deleted_at timestamptz;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in to delete a group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the group row up front (FOR UPDATE), so the read of `deleted_at` and
  -- the tombstone that follows see the same serialized view of the row. This
  -- closes the delete-vs-delete window and gives a single coordination point a
  -- balance-mutating writer can share (take the same row lock) to be serialized
  -- against a delete; on its own it does not stop a writer that never locks
  -- this row (see A49 review notes).
  SELECT deleted_at INTO v_deleted_at FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no such group' USING ERRCODE = 'no_data_found';
  END IF;

  -- Only an admin/owner may delete the group for everyone. The button hides for
  -- everyone else, but the client gate is a courtesy — this is the boundary.
  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'NOT_ADMIN: only an admin deletes a group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent: deleting an already-deleted group is a no-op, so a retried queue
  -- flush or a second tap lands cleanly rather than raising. Checked after the
  -- admin gate so a re-delete still answers a non-admin with NOT_ADMIN.
  IF v_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  -- The tombstone. The stamp trigger bumps `updated_seq`, so the change reaches
  -- every member's mirror on their next sync and the group leaves all their lists.
  UPDATE public.groups SET deleted_at = now() WHERE id = p_group_id;
END
$$;
