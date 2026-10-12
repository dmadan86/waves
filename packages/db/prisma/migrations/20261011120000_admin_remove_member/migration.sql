-- An admin removes a person from a group.
--
-- Leaving was always a soft exit: `left_at` is stamped and every access check
-- (`is_group_member`, `is_group_admin`, the pull) already reads it, so the
-- person drops out of the group while their expenses, shares and settlements
-- stay in the ledger. Removal is the same exit done to somebody else, which a
-- client cannot do for itself: the update policy lets you write your own row
-- (or a ghost's), never another account's. So it is an RPC, admin-only.
--
-- Nothing is deleted. Balances are derived from the ledger, so the removed
-- person's balance stays exactly as it was; the app warns the admin of it
-- before asking. Works for a ghost too (a placeholder has no account, so no
-- notification and nothing to revoke).
--
-- Coming back: the unique (group_id, profile_id) means the row is kept, and a
-- fresh invite brings it back to life (`invite-accept` clears `left_at`).

CREATE FUNCTION public.waves_remove_member(p_member_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_profile_id uuid;
  v_left_at    timestamptz;
  v_me         uuid := public.waves_current_profile_id();
  v_group_name text;
  v_admin_name text;
BEGIN
  SELECT group_id, profile_id, left_at
    INTO v_group_id, v_profile_id, v_left_at
  FROM public.group_members WHERE id = p_member_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such member' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_group_admin(v_group_id) THEN
    RAISE EXCEPTION 'NOT_ADMIN: only an admin removes a member'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_profile_id IS NOT DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_SELF: use Leave group'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_left_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: they are no longer in this group'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.group_members
     SET left_at = now(),
         updated_at = now()
   WHERE id = p_member_id;

  IF v_profile_id IS NOT NULL THEN
    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = v_group_id;
    SELECT p.display_name INTO v_admin_name FROM public.profiles p WHERE p.id = v_me;

    PERFORM public.waves_notify(
      v_profile_id,
      v_group_id,
      'member_removed',
      -- English fallback only; current builds re-render from kind + payload.
      'You were removed from ' || coalesce(nullif(v_group_name, ''), 'a group'),
      'Your past expenses stay in the group history',
      NULL,
      jsonb_build_object(
        'counterparty', coalesce(v_admin_name, ''),
        'group',        coalesce(v_group_name, '')
      ),
      'member_removed:' || p_member_id::text || ':' || floor(extract(epoch FROM now()))::text
    );
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.waves_remove_member(p_member_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_remove_member(p_member_id uuid) TO authenticated;
