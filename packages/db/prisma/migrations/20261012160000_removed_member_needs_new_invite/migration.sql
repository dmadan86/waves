-- A removed member needs a NEW invite to come back.
--
-- An admin's removal (waves_remove_member) only stamped left_at, the same as
-- leaving. waves_join_via_invite reactivates any left row for a caller holding a
-- valid invite, and the removed person still holds the link they were removed
-- through (or any other minted before). So removal did not stick: they tapped
-- the old link and were back, as a plain member.
--
-- Removal is now recorded apart from leaving:
--
--   group_members.removed_at   when an admin removed them (NULL: never, or left)
--   group_members.removed_by   the profile of the admin who did it
--
-- and the two doors that attach a profile through an invite compare the
-- invite's age with the removal:
--
--   - an invite minted at or before removed_at is REMOVED: refused, no use spent
--   - an invite minted after it is an admin deliberately inviting them back:
--     it reactivates the row as before and clears both columns
--   - somebody who left by themselves has removed_at NULL and rejoins with any
--     valid invite, as before
--
-- The doors are waves_join_via_invite (the direct join) and
-- waves_request_member_claim ("this placeholder is me", filed with an invite).
-- The durable group link (groups.join_token) is an ordinary invites row, so it
-- is covered by the same comparison: resetting the link mints a newer invite.
--
-- Removals made before this migration carry no removed_at and cannot be told
-- from a person leaving, so they are not retroactively blocked.

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'group_members_removed_by_fkey'
  ) THEN
    ALTER TABLE ONLY public.group_members
      ADD CONSTRAINT group_members_removed_by_fkey FOREIGN KEY (removed_by)
      REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END
$$;

-- waves_remove_member: also records who and when. The lock and every check are
-- unchanged from 20261012090000_remove_member_lock.
CREATE OR REPLACE FUNCTION public.waves_remove_member(p_member_id uuid) RETURNS void
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
  FROM public.group_members WHERE id = p_member_id
  FOR UPDATE;

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
         removed_at = now(),
         removed_by = v_me,
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

-- waves_join_via_invite: a removed person's old invite answers REMOVED before a
-- use is consumed. Otherwise as 20261011120000_join_requires_account, plus the
-- reactivation clears the removal.
CREATE OR REPLACE FUNCTION public.waves_join_via_invite(p_invite_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_created_at timestamptz;
  v_member_id  uuid;
  v_left_at    timestamptz;
  v_removed_at timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  IF public.waves_is_guest(p_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT group_id, created_at INTO v_group_id, v_created_at
    FROM public.invites WHERE id = p_invite_id;
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  -- Somebody already in the group is simply let through, and no use is spent
  -- (invite-accept has always answered "already a member" this way). Locked,
  -- so two taps at once cannot both reactivate or both insert.
  SELECT id, left_at, removed_at INTO v_member_id, v_left_at, v_removed_at
    FROM public.group_members
   WHERE group_id = v_group_id AND profile_id = p_profile_id
   FOR UPDATE;

  IF v_member_id IS NOT NULL AND v_left_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id, 'already_member', true);
  END IF;

  -- An admin removed them, and this invite is from before that: it is the link
  -- they were removed through. Only an invite minted after the removal is an
  -- admin asking them back. Checked before the use is spent.
  IF v_removed_at IS NOT NULL AND v_created_at <= v_removed_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REMOVED');
  END IF;

  IF public.waves_consume_invite(p_invite_id) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF v_member_id IS NOT NULL THEN
    -- Left, or removed and re-invited: (group_id, profile_id) is unique, so a
    -- fresh invite brings the same row back, as an ordinary member whatever
    -- they were before.
    UPDATE public.group_members
       SET left_at = NULL, removed_at = NULL, removed_by = NULL,
           role = 'member', joined_via = 'invite_link'
     WHERE id = v_member_id;
  ELSE
    INSERT INTO public.group_members (group_id, profile_id, joined_via)
    VALUES (v_group_id, p_profile_id, 'invite_link')
    RETURNING id INTO v_member_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id);
END
$$;

REVOKE ALL ON FUNCTION public.waves_join_via_invite(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_join_via_invite(uuid, uuid) TO service_role;

-- waves_request_member_claim: a removed person cannot ask to be a placeholder
-- through an invite from before their removal either (nor with no invite at
-- all). Body otherwise as 20261011120000_join_requires_account.
CREATE OR REPLACE FUNCTION public.waves_request_member_claim(p_group_id uuid, p_member_id uuid, p_profile_id uuid, p_name text DEFAULT NULL::text, p_invite_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_member     public.group_members%ROWTYPE;
  v_group      text;
  v_id         uuid;
  v_admin      record;
  v_consumed   boolean;
  v_removed_at timestamptz;
  v_invited_at timestamptz;
BEGIN
  IF public.waves_is_guest(p_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT * INTO v_member
    FROM public.group_members
   WHERE id = p_member_id AND group_id = p_group_id
   FOR UPDATE;

  IF NOT FOUND OR v_member.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  IF v_member.profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.group_members
     WHERE group_id = p_group_id AND profile_id = p_profile_id AND left_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_A_MEMBER');
  END IF;

  -- Removed by an admin: only an invite minted after the removal gets them a
  -- claim. Before any invite use is spent or any row is written.
  SELECT removed_at INTO v_removed_at
    FROM public.group_members
   WHERE group_id = p_group_id AND profile_id = p_profile_id AND removed_at IS NOT NULL
   ORDER BY removed_at DESC
   LIMIT 1;

  IF v_removed_at IS NOT NULL THEN
    SELECT created_at INTO v_invited_at FROM public.invites WHERE id = p_invite_id;
    IF v_invited_at IS NULL OR v_invited_at <= v_removed_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'REMOVED');
    END IF;
  END IF;

  SELECT id INTO v_id
    FROM public.member_claims
   WHERE member_id = p_member_id AND requester_id = p_profile_id AND status = 'pending';

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'claim_id', v_id, 'already_pending', true);
  END IF;

  IF p_invite_id IS NOT NULL THEN
    SELECT public.waves_consume_invite(p_invite_id) INTO v_consumed;
    IF v_consumed IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
    END IF;
  END IF;

  INSERT INTO public.member_claims (group_id, member_id, requester_id, requested_name)
  VALUES (p_group_id, p_member_id, p_profile_id, NULLIF(btrim(COALESCE(p_name, '')), ''))
  RETURNING id INTO v_id;

  SELECT name INTO v_group FROM public.groups WHERE id = p_group_id;

  FOR v_admin IN
    SELECT profile_id FROM public.group_members
     WHERE group_id = p_group_id AND role = 'admin'
       AND profile_id IS NOT NULL AND left_at IS NULL
  LOOP
    PERFORM public.waves_notify(
      v_admin.profile_id,
      p_group_id,
      'ghost_claim_requested',
      'Someone wants to join ' || COALESCE(v_group, 'a group'),
      'They say they are ' || COALESCE(v_member.ghost_name, 'someone already listed'),
      '/group/' || p_group_id::text || '/members',
      jsonb_build_object(
        'claim_id', v_id,
        'member_id', p_member_id,
        'ghost_name', v_member.ghost_name,
        'requested_name', NULLIF(btrim(COALESCE(p_name, '')), '')
      ),
      'claim:' || v_id::text || ':' || v_admin.profile_id::text
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_id, 'already_pending', false);
END
$$;

REVOKE ALL ON FUNCTION public.waves_request_member_claim(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_request_member_claim(uuid, uuid, uuid, text, uuid) TO service_role;

-- The membership column guard: a removal must not be undoable from the client.
-- group_members_update_self lets anyone UPDATE their own row, and nothing
-- stopped a removed person writing left_at = NULL on theirs, which put them back
-- with no invite at all. removed_at / removed_by are only ever written by
-- waves_remove_member and the re-invite above (both definer, not 'authenticated'),
-- and a removed row's left_at is not the client's to touch. Leaving by oneself
-- (left_at set on a row that was not removed) is untouched. Body otherwise as
-- the baseline.
CREATE OR REPLACE FUNCTION public.waves_guard_membership_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a role is not yours to change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a ghost is claimed by an admin approving a request, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a membership cannot move between groups'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.removed_at IS DISTINCT FROM OLD.removed_at
     OR NEW.removed_by IS DISTINCT FROM OLD.removed_by THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a removal is recorded by waves_remove_member, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.removed_at IS NOT NULL AND NEW.left_at IS DISTINCT FROM OLD.left_at THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a removed member comes back through a new invite, not an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$$;
