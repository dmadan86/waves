-- Somebody who LEFT a group needs a NEW invite to come back.
--
-- Removed members already do (20261012160000_removed_member_needs_new_invite): an
-- invite minted at or before removed_at is refused. Somebody who left by
-- themselves (left_at set, removed_at NULL) still rejoined with any valid invite,
-- including the group's durable link (groups.join_token, an ordinary invites
-- row), so leaving did not stick. Now an invite minted at or before left_at
-- answers LEFT (the edge function maps it to LEFT_GROUP), before any use is
-- spent; a newer invite (a member made a new link, or sent a fresh invite)
-- reactivates as before. Removed members keep REMOVED, and the company
-- employment-ended check in the waves_join_via_invite wrapper is untouched.
--
-- waves_join_via_invite is a wrapper since 20261113090000_company_vendors; the
-- membership logic lives in waves_join_via_invite_base, so that is redefined
-- (body as 20261110090000_company_managers_pools plus the LEFT check). Existing
-- self-leavers holding an old link are blocked until a new one is made.

CREATE OR REPLACE FUNCTION public.waves_join_via_invite_base(p_invite_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id   uuid;
  v_created_at timestamptz;
  v_inviter    uuid;
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

  SELECT group_id, created_at, created_by INTO v_group_id, v_created_at, v_inviter
    FROM public.invites WHERE id = p_invite_id;
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF public.waves_is_company(v_group_id) THEN
    PERFORM 1 FROM public.groups WHERE id=v_group_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.invites i JOIN public.group_members issuer ON issuer.profile_id=i.created_by AND issuer.group_id=i.group_id
      WHERE i.id=p_invite_id AND issuer.left_at IS NULL AND issuer.removed_at IS NULL AND issuer.role::text IN ('admin','manager')
      AND (i.company_manager_id IS NULL OR EXISTS(SELECT 1 FROM public.group_members m WHERE m.id=i.company_manager_id AND m.role::text='manager' AND m.left_at IS NULL AND m.removed_at IS NULL))) THEN RETURN jsonb_build_object('ok',false,'reason','INVITE_INVALID'); END IF;
  END IF;
  SELECT id, left_at, removed_at INTO v_member_id, v_left_at, v_removed_at
    FROM public.group_members
   WHERE group_id = v_group_id AND profile_id = p_profile_id
   FOR UPDATE;

  IF v_member_id IS NOT NULL AND v_left_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id, 'already_member', true);
  END IF;

  IF v_removed_at IS NOT NULL AND v_created_at <= v_removed_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REMOVED');
  END IF;

  -- They left by themselves and this invite is from before that: the link they
  -- left through. Checked before the use is spent.
  IF v_left_at IS NOT NULL AND v_removed_at IS NULL AND v_created_at <= v_left_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LEFT');
  END IF;

  IF public.waves_consume_invite(p_invite_id) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.group_members
       SET left_at = NULL, removed_at = NULL, removed_by = NULL,
           role = 'member', joined_via = 'invite_link', manager_id=(SELECT company_manager_id FROM public.invites WHERE id=p_invite_id)
     WHERE id = v_member_id;
  ELSE
    INSERT INTO public.group_members (group_id, profile_id, joined_via,manager_id)
    VALUES (v_group_id, p_profile_id, 'invite_link',(SELECT company_manager_id FROM public.invites WHERE id=p_invite_id))
    RETURNING id INTO v_member_id;
  END IF;

  IF v_inviter IS NOT NULL THEN
    BEGIN
      PERFORM public.waves_referral_register(p_profile_id, v_inviter, 'group_invite');
      PERFORM public.waves_referral_try_qualify(p_profile_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'group-invite referral failed for %: %', p_profile_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id);
END
$$;

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
  v_left_at    timestamptz;
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

  IF public.waves_is_company(p_group_id) AND (p_invite_id IS NOT NULL OR v_member.manager_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.invites i
    WHERE i.id=p_invite_id AND i.group_id=p_group_id AND i.company_manager_id IS NOT DISTINCT FROM v_member.manager_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','NOT_CLAIMABLE');
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

  -- Left by themselves: same rule, only an invite minted after they left.
  SELECT left_at INTO v_left_at
    FROM public.group_members
   WHERE group_id = p_group_id AND profile_id = p_profile_id
     AND left_at IS NOT NULL AND removed_at IS NULL
   ORDER BY left_at DESC
   LIMIT 1;

  IF v_left_at IS NOT NULL THEN
    SELECT created_at INTO v_invited_at FROM public.invites WHERE id = p_invite_id;
    IF v_invited_at IS NULL OR v_invited_at <= v_left_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'LEFT');
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

REVOKE ALL ON FUNCTION public.waves_join_via_invite_base(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_join_via_invite_base(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.waves_request_member_claim(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_request_member_claim(uuid, uuid, uuid, text, uuid) TO service_role;
