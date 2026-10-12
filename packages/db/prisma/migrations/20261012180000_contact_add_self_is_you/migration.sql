-- Adding yourself from your own contacts returns your own member row.
--
-- `waves_add_ghost_member` used to skip a match on the caller and insert a
-- ghost, so picking your own card (an easy slip in a long contact list) put a
-- "Not on Waves yet" copy of you in the group, splitting your share across two
-- members. Your own email or number now returns the row you already have.
-- Everything else is unchanged from 20261012170000_add_contact_links_account.

CREATE OR REPLACE FUNCTION public.waves_add_ghost_member(
  p_group_id uuid,
  p_name text,
  p_member_id uuid DEFAULT NULL::uuid,
  p_email text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_member_id  uuid;
  v_email      text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_phone      text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone_bare text;
  v_target     uuid;
  v_existing   public.group_members%ROWTYPE;
  v_group_name text;
  v_actor_name text;
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A name is no longer required, because picking an email out of a contact
  -- card often carries no usable one. Something is still required.
  IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'NOTHING_TO_ADD: give a name, an email or a number'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A number typed without its country code cannot be assumed Indian just
  -- because this is an India-first app — somebody on a trip is exactly the
  -- person whose contacts are foreign. Reject rather than guess wrong.
  IF v_phone IS NOT NULL AND v_phone !~ '^\+' THEN
    RAISE EXCEPTION 'PHONE_NEEDS_COUNTRY_CODE: % has no country code', v_phone
      USING ERRCODE = 'check_violation';
  END IF;

  -- Replay of a queued offline mutation returns the same member (ADR-005).
  IF p_member_id IS NOT NULL THEN
    SELECT id INTO v_member_id FROM public.group_members
     WHERE id = p_member_id AND group_id = p_group_id;
    IF FOUND THEN
      RETURN v_member_id;
    END IF;
  END IF;

  -- Adding the same person twice is the common accident when picking from a
  -- contact list, and two ghosts for one human split their balance in half.
  -- Matched on contact rather than name: two people really can be called Ravi.
  IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
    SELECT gm.id INTO v_member_id
      FROM public.group_members gm
     WHERE gm.group_id = p_group_id
       AND gm.left_at IS NULL
       AND ((v_email IS NOT NULL AND gm.invite_email = v_email)
         OR (v_phone IS NOT NULL AND gm.invite_phone = v_phone))
     LIMIT 1;
    IF v_member_id IS NOT NULL THEN
      RETURN v_member_id;
    END IF;
  END IF;

  -- ── Is this somebody already on Waves? ─────────────────────────────────────
  -- `auth.users` stores phone as bare E.164 digits (no leading '+'), so the
  -- typed number is compared digits to digits.
  --
  -- Guarded on `auth.users` existing: the DB test suite runs these RPCs against
  -- a bare Postgres with no `auth` schema. No auth table means no accounts to
  -- match, so a plain ghost is exactly right.
  IF to_regclass('auth.users') IS NOT NULL AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
    v_phone_bare := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');

    SELECT u.id INTO v_target
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE u.deleted_at IS NULL
       AND (
         (v_email IS NOT NULL AND lower(u.email) = v_email AND p.discoverable_by_email)
         OR (v_phone_bare IS NOT NULL
             AND p.discoverable_by_phone
             AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare)
       )
     ORDER BY (v_email IS NOT NULL AND lower(u.email) = v_email) DESC
     LIMIT 1;

    -- Yourself, picked from your own contacts: you are already in, so that row
    -- is the answer. Checked against your own account whatever its
    -- discoverability, which only hides you from other people.
    IF EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = v_profile_id
         AND ((v_email IS NOT NULL AND lower(u.email) = v_email)
           OR (v_phone_bare IS NOT NULL
               AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare))
    ) THEN
      SELECT gm.id INTO v_member_id
        FROM public.group_members gm
       WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL;
      RETURN v_member_id;
    END IF;

    IF v_target = v_profile_id THEN
      v_target := NULL;
    END IF;

    IF v_target IS NOT NULL THEN
      SELECT * INTO v_existing
        FROM public.group_members gm
       WHERE gm.group_id = p_group_id AND gm.profile_id = v_target;
      IF FOUND THEN
        -- Already inside: that row is who they meant.
        IF v_existing.left_at IS NULL THEN
          RETURN v_existing.id;
        END IF;
        -- Left or removed: a ghost, and no tap — they are not being let back in.
        v_target := NULL;
      END IF;
    END IF;
  END IF;

  IF v_target IS NOT NULL THEN
    INSERT INTO public.group_members
      (id, group_id, profile_id, joined_via, invite_email, invite_phone)
    VALUES
      (COALESCE(p_member_id, gen_random_uuid()), p_group_id, v_target, 'contact', v_email, v_phone)
    RETURNING id INTO v_member_id;

    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = p_group_id;
    SELECT p.display_name INTO v_actor_name FROM public.profiles p WHERE p.id = v_profile_id;

    PERFORM public.waves_notify(
      v_target,
      p_group_id,
      'group_added',
      -- English fallback only; every current build re-renders from kind +
      -- payload in the reader's own language (see render.ts). `counterparty`
      -- is the fact `{actor}` reads from; `group` is `{group}`.
      coalesce(v_actor_name, 'Someone') || ' added you to ' || coalesce(v_group_name, 'a group'),
      'Tap to open the group',
      'waves://group/' || p_group_id::text,
      jsonb_build_object(
        'counterparty', coalesce(v_actor_name, ''),
        'group',        coalesce(v_group_name, '')
      ),
      'group_added:' || p_group_id::text || ':' || v_target::text
    );

    RETURN v_member_id;
  END IF;

  INSERT INTO public.group_members
    (id, group_id, ghost_name, joined_via, invite_email, invite_phone)
  VALUES
    (COALESCE(p_member_id, gen_random_uuid()), p_group_id,
     COALESCE(v_name, v_email, v_phone), 'ghost', v_email, v_phone)
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.waves_add_ghost_member(uuid, text, uuid, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.waves_add_ghost_member(uuid, text, uuid, text, text) TO authenticated, service_role;
