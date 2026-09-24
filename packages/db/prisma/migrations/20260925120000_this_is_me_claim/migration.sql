-- "This is me": a member already in a group takes the placeholder that was
-- added for them.
--
-- Renny adds "Gemahl" by name and files the rent against it. Gemahl later
-- joins by link (or switches from a guest, #990) and arrives as a second,
-- empty member: the group shows the same person twice, and everything owed
-- sits on the placeholder. The claim path (ADR-006) only served somebody not
-- yet in the group, and refused anybody who was (ALREADY_A_MEMBER).
--
--   waves_claim_member_as_me(member)   a member asks for a placeholder in
--                                      their own group. An admin asking is
--                                      confirmed at once; anybody else waits
--                                      for an admin, as every claim does.
--   waves_decide_member_claim          on approval, a requester already in
--                                      the group has their own row retired
--                                      (left, profile released) and takes the
--                                      placeholder, role and all. Only if
--                                      their own row is empty: nothing on an
--                                      append-only ledger can be moved.
--   waves_member_has_history(member)   the test for "empty": an expense
--                                      created, a share, a payment or a
--                                      settlement.

CREATE FUNCTION public.waves_member_has_history(p_member_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.expenses WHERE created_by = p_member_id)
      OR EXISTS (SELECT 1 FROM public.expense_shares WHERE member_id = p_member_id)
      OR EXISTS (SELECT 1 FROM public.expense_payers WHERE member_id = p_member_id)
      OR EXISTS (
           SELECT 1 FROM public.settlements
            WHERE from_member_id = p_member_id OR to_member_id = p_member_id
         );
$$;

REVOKE ALL ON FUNCTION public.waves_member_has_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_member_has_history(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.waves_decide_member_claim(p_claim_id uuid, p_approve boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile   uuid := public.waves_current_profile_id();
  v_claim     public.member_claims%ROWTYPE;
  v_admin_id  uuid;
  v_group     text;
  v_ghost     text;
  v_moved     integer;
  v_own       public.group_members%ROWTYPE;
  v_role      text := 'member';
  v_via       text := 'invite_link_claim';
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  SELECT * INTO v_claim FROM public.member_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_CLAIM');
  END IF;

  SELECT id INTO v_admin_id
    FROM public.group_members
   WHERE group_id = v_claim.group_id
     AND profile_id = v_profile
     AND role = 'admin'
     AND left_at IS NULL;

  -- Not an admin of this group. The same answer as a claim that does not
  -- exist, so this cannot be used to find out which claims do.
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_CLAIM');
  END IF;

  IF v_claim.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_DECIDED', 'status', v_claim.status);
  END IF;

  SELECT name INTO v_group FROM public.groups WHERE id = v_claim.group_id;
  SELECT ghost_name INTO v_ghost FROM public.group_members WHERE id = v_claim.member_id;

  IF NOT p_approve THEN
    UPDATE public.member_claims
       SET status = 'declined', decided_by = v_admin_id, decided_at = now()
     WHERE id = p_claim_id;

    PERFORM public.waves_notify(
      v_claim.requester_id,
      v_claim.group_id,
      'ghost_claim_declined',
      'Not confirmed',
      COALESCE(v_group, 'The group') || ' did not confirm that place. You can still join as yourself.',
      '/join',
      jsonb_build_object('claim_id', p_claim_id, 'group_name', v_group),
      'claim_declined:' || p_claim_id::text
    );

    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  -- The place must still be free before anything else is touched: a refusal
  -- after the requester's own row is retired below would leave them out of the
  -- group altogether.
  PERFORM 1 FROM public.group_members
   WHERE id = v_claim.member_id
     AND profile_id IS NULL
     AND left_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  -- Already in the group as themselves: they joined by another route while
  -- this sat waiting, or they are saying "this is me" from inside the group
  -- (20260925120000). One person must not end up as two members, so their own
  -- row gives way to the placeholder, which is the one the history is filed
  -- under. Only an empty row can give way: the ledger is append-only
  -- (ADR-004), so a share or a payment already on it could never be moved.
  SELECT * INTO v_own
    FROM public.group_members
   WHERE group_id = v_claim.group_id
     AND profile_id = v_claim.requester_id
     AND left_at IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF public.waves_member_has_history(v_own.id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'HAS_HISTORY');
    END IF;

    v_role := v_own.role;
    v_via := 'self_claim';

    -- Retired, not deleted: the row's id may still be named by an activity
    -- entry or a comment. It lets go of the profile (one live row per person
    -- per group, and the unique index counts left rows too) and keeps the
    -- person's name as its label.
    UPDATE public.group_members
       SET profile_id = NULL,
           ghost_name = COALESCE(
             NULLIF(btrim((SELECT display_name FROM public.profiles WHERE id = v_claim.requester_id)), ''),
             'Member'
           ),
           role = 'member',
           left_at = now()
     WHERE id = v_own.id;
  END IF;

  UPDATE public.group_members
     SET profile_id = v_claim.requester_id,
         ghost_name = NULL,
         joined_via = v_via,
         role = CASE WHEN v_role = 'admin' THEN 'admin' ELSE role END
   WHERE id = v_claim.member_id
     AND profile_id IS NULL
     AND left_at IS NULL;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  -- The name they gave, written only now. `invite-accept` used to set it while
  -- claiming, which meant an unconfirmed stranger could rename their own
  -- profile through a join request. And only over the placeholder: somebody
  -- who named themselves two years ago must not be renamed by a group they
  -- have just joined.
  IF v_claim.requested_name IS NOT NULL THEN
    UPDATE public.profiles
       SET display_name = v_claim.requested_name
     WHERE id = v_claim.requester_id
       AND (display_name IS NULL OR display_name = '' OR display_name = 'Guest');
  END IF;

  UPDATE public.member_claims
     SET status = 'approved', decided_by = v_admin_id, decided_at = now()
   WHERE id = p_claim_id;

  -- Anybody else waiting on the same place has lost it. Leaving them pending
  -- would mean an admin later approving a claim on a member who now belongs to
  -- somebody, and being told NOT_CLAIMABLE with no idea why.
  UPDATE public.member_claims
     SET status = 'declined', decided_by = v_admin_id, decided_at = now()
   WHERE member_id = v_claim.member_id
     AND status = 'pending'
     AND id <> p_claim_id;

  -- An admin saying "this is me" confirms their own claim; telling them they
  -- are in is noise.
  IF v_claim.requester_id <> v_profile THEN
  PERFORM public.waves_notify(
    v_claim.requester_id,
    v_claim.group_id,
    'ghost_claim_approved',
    'You are in ' || COALESCE(v_group, 'the group'),
    'Everything already filed under ' || COALESCE(v_ghost, 'that name') || ' is yours',
    '/group/' || v_claim.group_id::text,
    jsonb_build_object('claim_id', p_claim_id, 'group_name', v_group, 'ghost_name', v_ghost),
    'claim_approved:' || p_claim_id::text
  );
  END IF;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    v_claim.group_id,
    v_claim.member_id,
    'claimed',
    'member',
    v_claim.member_id,
    jsonb_build_object(
      'via', CASE WHEN v_via = 'self_claim' THEN 'this_is_me' ELSE 'invite_link' END,
      'confirmed_by', v_admin_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'member_id', v_claim.member_id);
END
$$;


CREATE FUNCTION public.waves_claim_member_as_me(p_member_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_ghost   public.group_members%ROWTYPE;
  v_own     public.group_members%ROWTYPE;
  v_group   text;
  v_name    text;
  v_id      uuid;
  v_admin   record;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  -- Locked, as `waves_request_member_claim` locks it, so two asks for one
  -- place are serialised.
  SELECT * INTO v_ghost FROM public.group_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR v_ghost.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  SELECT * INTO v_own
    FROM public.group_members
   WHERE group_id = v_ghost.group_id AND profile_id = v_profile AND left_at IS NULL;

  -- Not in this group: the same answer as a place that does not exist, so this
  -- cannot be used to probe other groups. Somebody outside joins by the link,
  -- which has its own claim.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  IF v_ghost.profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  END IF;

  -- Said now, not after an admin has been asked: they could only approve it
  -- into the same refusal.
  IF public.waves_member_has_history(v_own.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'HAS_HISTORY');
  END IF;

  SELECT id INTO v_id
    FROM public.member_claims
   WHERE member_id = p_member_id AND requester_id = v_profile AND status = 'pending';

  IF v_id IS NULL THEN
    INSERT INTO public.member_claims (group_id, member_id, requester_id)
    VALUES (v_ghost.group_id, p_member_id, v_profile)
    RETURNING id INTO v_id;
  END IF;

  -- An admin can already rewrite this group's ledger by editing it; asking
  -- another admin to confirm their own name would be ceremony.
  IF v_own.role = 'admin' THEN
    RETURN public.waves_decide_member_claim(v_id, true);
  END IF;

  SELECT name INTO v_group FROM public.groups WHERE id = v_ghost.group_id;
  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_profile;

  FOR v_admin IN
    SELECT profile_id FROM public.group_members
     WHERE group_id = v_ghost.group_id AND role = 'admin'
       AND profile_id IS NOT NULL AND left_at IS NULL
  LOOP
    PERFORM public.waves_notify(
      v_admin.profile_id,
      v_ghost.group_id,
      'ghost_claim_requested',
      COALESCE(v_name, 'A member') || ' says they are ' || COALESCE(v_ghost.ghost_name, 'someone listed'),
      'Nothing changes until you confirm.',
      '/group/' || v_ghost.group_id::text || '/members',
      jsonb_build_object(
        'claim_id', v_id,
        'member_id', p_member_id,
        'ghost_name', v_ghost.ghost_name,
        'requested_name', v_name
      ),
      'claim:' || v_id::text || ':' || v_admin.profile_id::text
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'status', 'pending', 'claim_id', v_id);
END
$$;

REVOKE ALL ON FUNCTION public.waves_claim_member_as_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_claim_member_as_me(uuid) TO authenticated, service_role;
