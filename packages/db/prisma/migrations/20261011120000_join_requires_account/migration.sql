-- Joining a shared group needs an account (ADR-006 amendment, 2026-10-11).
--
-- Opening an invite link used to be possible as an anonymous guest. It is not
-- any more: the caller must be a signed-up (non-anonymous) user. The edge
-- function says so first, but a modified client must not be able to get round
-- it, so the refusal also lives here, in three places that together cover every
-- way a profile gets attached to somebody else's group:
--
--   1. waves_join_via_invite        the direct join (new; invite-accept calls it)
--   2. waves_request_member_claim   the "this placeholder is me" request
--   3. a trigger on group_members   the backstop for any other writer,
--      including approval of a claim a guest filed before this migration
--
-- Nobody is removed. A guest already in a group keeps it: the trigger fires
-- only when a profile is attached to a row, never on later updates, and a
-- guest creating their own group (joined_via = 'creator') is not joining.
-- "This is me" inside a group one is already in (joined_via = 'self_claim')
-- is not a new join either.
--
-- `waves_is_guest` (20260907090000) is the one place that asks auth.users
-- whether an account is anonymous; where the column does not exist (the stub
-- schema the DB tests run on) it answers false.

CREATE OR REPLACE FUNCTION public.waves_require_account(p_profile_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF public.waves_is_guest(p_profile_id) THEN
    RAISE EXCEPTION 'ACCOUNT_REQUIRED: sign up or log in to join a group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.waves_require_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_require_account(uuid) TO service_role;

-- The direct join, atomically: refuse a guest BEFORE a use of the invite is
-- spent, then consume and insert. Returns a verdict rather than raising, like
-- the claim RPC beside it.
CREATE OR REPLACE FUNCTION public.waves_join_via_invite(p_invite_id uuid, p_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id  uuid;
  v_member_id uuid;
  v_left_at   timestamptz;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  IF public.waves_is_guest(p_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  SELECT group_id INTO v_group_id FROM public.invites WHERE id = p_invite_id;
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  -- Somebody already in the group is simply let through, and no use is spent
  -- (invite-accept has always answered "already a member" this way). Locked,
  -- so two taps at once cannot both reactivate or both insert.
  SELECT id, left_at INTO v_member_id, v_left_at
    FROM public.group_members
   WHERE group_id = v_group_id AND profile_id = p_profile_id
   FOR UPDATE;

  IF v_member_id IS NOT NULL AND v_left_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'member_id', v_member_id, 'group_id', v_group_id, 'already_member', true);
  END IF;

  IF public.waves_consume_invite(p_invite_id) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_INVALID');
  END IF;

  IF v_member_id IS NOT NULL THEN
    -- Left, or removed by an admin: both only stamp left_at, and (group_id,
    -- profile_id) is unique, so a fresh invite brings the same row back, as an
    -- ordinary member whatever they were before.
    UPDATE public.group_members
       SET left_at = NULL, role = 'member', joined_via = 'invite_link'
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

-- The claim request: the body is the baseline's, with the account check as its
-- first statement so a guest costs no invite use and writes no row.
CREATE OR REPLACE FUNCTION public.waves_request_member_claim(p_group_id uuid, p_member_id uuid, p_profile_id uuid, p_name text DEFAULT NULL::text, p_invite_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_member   public.group_members%ROWTYPE;
  v_group    text;
  v_id       uuid;
  v_admin    record;
  v_consumed boolean;
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

-- The backstop. Fires when a profile is attached to a membership row by an
-- invite (insert, a claim being approved onto a placeholder, or a row being
-- relabelled as invite-joined), whoever wrote it. Later updates to an existing membership are untouched, so a guest who is
-- already in a group keeps it.
CREATE OR REPLACE FUNCTION public.waves_guard_join_needs_account() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL
     AND NEW.joined_via IN ('invite_link', 'invite_link_claim')
     AND (TG_OP = 'INSERT'
          OR OLD.profile_id IS DISTINCT FROM NEW.profile_id
          OR OLD.joined_via IS DISTINCT FROM NEW.joined_via) THEN
    PERFORM public.waves_require_account(NEW.profile_id);
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_guard_join_needs_account() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_guard_join_needs_account() TO service_role;

DROP TRIGGER IF EXISTS group_members_join_needs_account ON public.group_members;
CREATE TRIGGER group_members_join_needs_account
  BEFORE INSERT OR UPDATE OF profile_id, joined_via ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.waves_guard_join_needs_account();

-- Claims a guest filed before this migration can no longer be approved (the
-- trigger would refuse it). Close them now rather than leave an admin a button
-- that errors. Guarded like waves_is_guest: the stub auth schema has no flag.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_anonymous'
     ) THEN
    EXECUTE $q$
      UPDATE public.member_claims
         SET status = 'declined', decided_at = now()
       WHERE status = 'pending'
         AND requester_id IN (SELECT id FROM auth.users WHERE is_anonymous)
    $q$;
  END IF;
END
$$;
