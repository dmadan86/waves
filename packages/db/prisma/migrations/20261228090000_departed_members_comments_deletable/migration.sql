-- Anyone still in the group may delete a comment whose author has left or been
-- removed. Until now only the author or an admin could, so in a group with no
-- admin around, a departed member's old comment stayed for ever. deleted_by
-- still records who did it, which the Activity feed shows.
--
-- Otherwise as the baseline: the caller must be a member; own comment or admin
-- are allowed as before; deleting a missing comment is a no-op.
CREATE OR REPLACE FUNCTION public.waves_delete_expense_comment(p_comment_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id uuid;
  v_author   uuid;
  v_me       uuid;
BEGIN
  SELECT group_id, author_member_id INTO v_group_id, v_author
    FROM public.expense_comments WHERE id = p_comment_id;
  IF v_group_id IS NULL THEN
    RETURN; -- Never existed. Removing nothing is not an error.
  END IF;
  IF NOT public.is_group_member(v_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_me := public.waves_my_member_id(v_group_id);
  IF NOT (
    v_author = v_me
    OR public.is_group_admin(v_group_id)
    OR EXISTS (SELECT 1 FROM public.group_members m WHERE m.id = v_author AND m.left_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'CANNOT_DELETE: only the author or an admin can delete this'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.expense_comments
     SET deleted_at = now(), deleted_by = v_me
   WHERE id = p_comment_id AND deleted_at IS NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_delete_expense_comment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_delete_expense_comment(uuid) TO authenticated, service_role;
