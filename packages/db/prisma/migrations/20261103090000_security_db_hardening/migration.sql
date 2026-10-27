-- Security findings: client inserts could forge membership privilege/removal state;
-- members could change placeholder payment/contact details and admin group settings;
-- approved claims could inherit a placeholder's role; client invites could bypass
-- use/expiry limits; members could delete another member's uploads; OTP request
-- counts could be weaponized to block a phone's owner. Preserve trusted RPC writes.

CREATE OR REPLACE FUNCTION public.waves_guard_membership_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.role := 'member';
    NEW.merged_into_member_id := NULL;
    NEW.removed_at := NULL;
    NEW.removed_by := NULL;
  END IF;
  RETURN NEW;
END
$function$
;
DROP TRIGGER IF EXISTS group_members_guard_insert ON public.group_members;
CREATE TRIGGER group_members_guard_insert BEFORE INSERT ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.waves_guard_membership_insert();

CREATE OR REPLACE FUNCTION public.waves_guard_membership_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF NEW.merged_into_member_id IS DISTINCT FROM OLD.merged_into_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a placeholder is merged by waves_merge_member_into, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.profile_id IS NULL
     AND (NEW.vpa IS DISTINCT FROM OLD.vpa
       OR NEW.payment_handle IS DISTINCT FROM OLD.payment_handle
       OR NEW.payment_rail IS DISTINCT FROM OLD.payment_rail
       OR NEW.invite_email IS DISTINCT FROM OLD.invite_email
       OR NEW.invite_phone IS DISTINCT FROM OLD.invite_phone)
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: only an admin changes a placeholder''s payment or contact details'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION public.waves_guard_group_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_allowed constant text[] := ARRAY[
    'name',
    'description',
    'type',
    'cover_emoji',
    'photo_path',
    'simplify_debts',
    'default_currency',
    'country_code',
    'archived_at',
    'start_date',
    'end_date',
    'time_zone',
    'remind_daily',
    'remind_morning_at',
    'remind_evening_at',
    'event_template',
    'custom_tag',
    'cover_color',
    'units'
  ];
  v_refused text;
BEGIN
  IF NEW.default_currency IS DISTINCT FROM OLD.default_currency
     AND (
       EXISTS (SELECT 1 FROM public.expenses e WHERE e.group_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.settlements st WHERE st.group_id = NEW.id)
       OR COALESCE(OLD.fx_rates, '{}'::jsonb) <> '{}'::jsonb
     ) THEN
    RAISE EXCEPTION
      'CURRENCY_LOCKED: a group''s currency cannot change once it has bills, rates or settlements'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(changed.key, ', ' ORDER BY changed.key)
    INTO v_refused
    FROM jsonb_each(to_jsonb(NEW)) AS changed(key, value)
   WHERE changed.value IS DISTINCT FROM (to_jsonb(OLD) -> changed.key)
     AND NOT (changed.key = ANY (v_allowed));

  IF v_refused IS NOT NULL THEN
    RAISE EXCEPTION
      'FORBIDDEN_COLUMN: % is set by the server or through its own RPC, not by a direct write', v_refused
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.photo_path IS DISTINCT FROM OLD.photo_path
     AND NEW.photo_path IS NOT NULL
     AND NOT public.waves_can_upload_group_photo(NEW.id) THEN
    RAISE EXCEPTION 'PHOTO_GATE: a group photo is a paid feature'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at
     OR NEW.simplify_debts IS DISTINCT FROM OLD.simplify_debts THEN
    IF NOT public.is_group_admin(NEW.id) THEN
      RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin archives a group or changes debt simplification'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ── new: only an admin arranges the families ────────────────────────────
  IF NEW.units IS DISTINCT FROM OLD.units THEN
    IF NOT public.is_group_admin(NEW.id) THEN
      RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes the families'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM public.waves_check_group_units(NEW.id, NEW.units);
  END IF;

  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION public.waves_decide_member_claim(p_claim_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         role = v_role
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
$function$
;

CREATE OR REPLACE FUNCTION public.waves_guard_invite_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    NEW.use_count := 0;
    NEW.max_uses := LEAST(GREATEST(COALESCE(NEW.max_uses, 50), 1), 100);
    NEW.expires_at := LEAST(COALESCE(NEW.expires_at, now() + interval '30 days'), now() + interval '30 days');
    NEW.revoked_at := NULL;
  END IF;
  RETURN NEW;
END
$function$
;
DROP TRIGGER IF EXISTS invites_guard_insert ON public.invites;
CREATE TRIGGER invites_guard_insert BEFORE INSERT ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.waves_guard_invite_insert();

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'storage schema absent (plain Postgres): skipping';
    RETURN;
  END IF;

  EXECUTE $policy$
    DROP POLICY IF EXISTS "group photos are removable by members" ON storage.objects;
    CREATE POLICY "group photos are removable by members" ON storage.objects
      FOR DELETE TO authenticated, anon
      USING (
        bucket_id = 'group-photos'
        AND public.is_group_member(public.waves_group_from_storage_path(name))
        AND (
          owner_id = (select auth.uid())::text
          OR public.is_group_admin(public.waves_group_from_storage_path(name))
        )
      );

    DROP POLICY IF EXISTS "receipts are removable by members" ON storage.objects;
    CREATE POLICY "receipts are removable by members" ON storage.objects
      FOR DELETE TO authenticated, anon
      USING (
        bucket_id = 'receipts'
        AND public.is_group_member(public.waves_group_from_storage_path(name))
        AND (
          owner_id = (select auth.uid())::text
          OR public.is_group_admin(public.waves_group_from_storage_path(name))
        )
      );
  $policy$;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_phone_gate(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cap        integer;
  v_until      timestamptz;
  v_today      date := (now() AT TIME ZONE 'utc')::date;
  v_hits       integer;
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'waves_phone_gate needs an E.164 number';
  END IF;

  v_cap        := COALESCE((SELECT value FROM public.app_config WHERE key = 'otp_daily_cap'), 3);

  -- A live block ends it here, and nothing is counted: a blocked number must not
  -- be able to keep its own strike record warm by hammering a door that is shut.
  SELECT until INTO v_until
    FROM public.phone_blocks
   WHERE phone = p_phone
     AND (until IS NULL OR until > now());
  IF FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'blocked',
      'retryAfter', CASE WHEN v_until IS NULL THEN NULL
                         ELSE GREATEST(0, extract(epoch FROM v_until - now())::integer) END
    );
  END IF;

  -- An expired block is cleared rather than left to be stepped over every time.
  DELETE FROM public.phone_blocks WHERE phone = p_phone;

  -- The day's count. `hits` is what this ask makes it, so the cap is met at the
  -- hit that equals it and refused at the one after.
  INSERT INTO public.phone_otp_strikes AS existing (phone, day, hits)
  VALUES (p_phone, v_today, 1)
  ON CONFLICT (phone, day) DO UPDATE SET hits = existing.hits + 1
  RETURNING existing.hits INTO v_hits;

  -- Request counts alone must never block a phone: an unauthenticated caller
  -- could otherwise deny its owner access. Keep the daily cap and existing blocks.

  IF v_hits <= v_cap THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'remaining', v_cap - v_hits);
  END IF;

  -- Spent for today, but not yet a pattern. Midnight UTC rather than the
  -- caller's midnight: a number is not in a timezone, and a day that moved with
  -- whoever was asking would be a fourth code for the price of a flight.
  RETURN jsonb_build_object(
    'allowed', false,
    'reason', 'spent',
    -- `(date)::timestamp AT TIME ZONE 'utc'`, not a cast through text: a plain
    -- cast to timestamptz reads the *session's* time zone, so on a connection
    -- that is not UTC this points at midnight somewhere else and can come back
    -- negative — a "try again in -3 hours" on the one screen somebody is stuck on.
    'retryAfter',
    extract(epoch FROM (((v_today + 1)::timestamp AT TIME ZONE 'utc') - now()))::integer
  );
END;
$function$
;
