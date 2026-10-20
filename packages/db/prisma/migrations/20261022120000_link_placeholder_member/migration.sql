-- "Link to a Waves user": an admin says which real person a placeholder is.
--
-- Somebody adds "Renny" by name, files seven expenses against it, and Renny
-- turns out to be a person who already uses Waves. Until now the only doors
-- were Renny saying "This is me" from inside the group, or Renny claiming the
-- place through a join link — both need Renny to notice and act. The admin,
-- who knows exactly who Renny is, had no way to say so.
--
-- Two shapes, decided by whether that person is already in the group:
--
--   A. Already in the group as themselves (the same person listed twice).
--      `waves_merge_member_into(placeholder, member)` folds the placeholder
--      into them, on the spot: the admin may already rewrite this group's
--      ledger by editing every bill, and nobody's account changes hands.
--
--   B. Not in the group. `waves_request_member_link(placeholder, profile)`
--      asks that person: "Madan says you are Renny in Goa trip — Accept /
--      Not me". Only they can answer (`waves_decide_member_link`), because
--      attaching somebody's account to a history they never saw is theirs to
--      agree to, not the admin's to do. Accepting is the same claim an admin
--      approving a join request performs; declining tells the admin.
--
-- The fold itself (`waves_fold_member_into`) stays inside ADR-004. Nothing on
-- the ledger is updated in place: every bill the placeholder was on gets one
-- new version with its payers and shares re-pointed, exactly as an edit
-- would, and the old version stays. A settlement between the two is a payment
-- from a person to themselves once they are one, so it is cancelled (the one
-- transition the guard does not otherwise allow, opened only inside the
-- fold). The placeholder row is retired, not deleted — activity entries and
-- comments may still name it — and points at the member it became.

-- ───────────────────────────────────────────────── where a placeholder went ──

ALTER TABLE public.group_members
  ADD COLUMN merged_into_member_id uuid;
ALTER TABLE ONLY public.group_members
  ADD CONSTRAINT group_members_merged_into_member_id_fkey FOREIGN KEY (merged_into_member_id)
  REFERENCES public.group_members(id) ON UPDATE NO ACTION ON DELETE NO ACTION;

COMMENT ON COLUMN public.group_members.merged_into_member_id IS
  'Set when this placeholder was folded into another member of the same group (link_placeholder_member). The row is retired (left_at) and kept for the history that names it.';

CREATE INDEX group_members_merged_into_member_id_idx
  ON public.group_members (merged_into_member_id);

-- Clients may not write it: the fold is the only thing that sets it.
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

  IF NEW.merged_into_member_id IS DISTINCT FROM OLD.merged_into_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN_COLUMN: a placeholder is merged by waves_merge_member_into, not by an update'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$$;

-- ──────────────────────────────────────────────────── the ask, as a table ──

CREATE TABLE public.member_link_requests (
    id                uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id          uuid NOT NULL,
    member_id         uuid NOT NULL,
    target_profile_id uuid NOT NULL,
    requested_by      uuid NOT NULL,
    status            text DEFAULT 'pending' NOT NULL,
    decided_at        timestamp with time zone,
    created_at        timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_link_requests_pkey PRIMARY KEY (id),
    CONSTRAINT member_link_requests_status_known
      CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    CONSTRAINT member_link_requests_decided_shape
      CHECK ((status = 'pending') = (decided_at IS NULL))
);

ALTER TABLE ONLY public.member_link_requests
  ADD CONSTRAINT member_link_requests_group_id_fkey FOREIGN KEY (group_id)
  REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.member_link_requests
  ADD CONSTRAINT member_link_requests_member_id_fkey FOREIGN KEY (member_id)
  REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.member_link_requests
  ADD CONSTRAINT member_link_requests_target_profile_id_fkey FOREIGN KEY (target_profile_id)
  REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.member_link_requests
  ADD CONSTRAINT member_link_requests_requested_by_fkey FOREIGN KEY (requested_by)
  REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;

COMMENT ON TABLE public.member_link_requests IS
  'An admin saying a placeholder member is a particular Waves user. Only that user can accept (link_placeholder_member).';

-- One open ask per placeholder — a second admin naming a second person while
-- the first is unanswered would leave two people able to take one place — is
-- enforced in `waves_request_member_link` under a lock on the placeholder row,
-- not by a partial unique index: Prisma's datamodel cannot express one, and an
-- index it cannot see is a permanently failing `db:drift` (see MemberClaim).
CREATE INDEX member_link_requests_member_id_status_idx
  ON public.member_link_requests (member_id, status);
CREATE INDEX member_link_requests_target_profile_id_status_idx
  ON public.member_link_requests (target_profile_id, status);
CREATE INDEX member_link_requests_requested_by_created_at_idx
  ON public.member_link_requests (requested_by, created_at);
CREATE INDEX member_link_requests_group_id_status_idx
  ON public.member_link_requests (group_id, status);

ALTER TABLE public.member_link_requests ENABLE ROW LEVEL SECURITY;

-- Readable by the person asked, the person who asked, and the group's admins.
-- Nobody writes it directly: the functions below are the only doors.
CREATE POLICY member_link_requests_visible ON public.member_link_requests
  FOR SELECT TO authenticated
  USING (
    target_profile_id = public.waves_current_profile_id()
    OR requested_by = public.waves_current_profile_id()
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = member_link_requests.group_id
         AND gm.profile_id = public.waves_current_profile_id()
         AND gm.role = 'admin'
         AND gm.left_at IS NULL
    )
  );

REVOKE ALL ON TABLE public.member_link_requests FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.member_link_requests TO authenticated;
GRANT ALL ON TABLE public.member_link_requests TO service_role;

-- ─────────────────────────── a settlement between a person and themselves ──

-- The fold cancels a settlement whose two ends have become one person. That
-- is the one transition the guard refuses from any state, so it is opened by
-- a transaction-local setting the fold alone sets — the same device
-- `waves_undo_import` uses — and the payee is not told, because there is no
-- payee: it was the same person.
CREATE OR REPLACE FUNCTION public.waves_settlement_transition() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'initiated'  AND NEW.status IN ('confirmed', 'auto_confirmed', 'disputed', 'cancelled'))
    OR (OLD.status = 'auto_confirmed' AND NEW.status = 'disputed')
    OR (OLD.status = 'disputed' AND NEW.status IN ('confirmed', 'cancelled'))
    OR (
      -- waves_undo_import, for a settlement that import wrote.
      OLD.status IN ('confirmed', 'auto_confirmed') AND NEW.status = 'cancelled'
      AND current_user NOT IN ('anon', 'authenticated')
      AND NEW.import_batch_id IS NOT NULL
      AND current_setting('waves.undoing_import', true) = NEW.import_batch_id::text
    )
    OR (
      -- waves_fold_member_into, for a payment between two members who have
      -- just become one person.
      NEW.status = 'cancelled'
      AND current_user NOT IN ('anon', 'authenticated')
      AND COALESCE(current_setting('waves.merging_member', true), '') = 'on'
    )
  ) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: settlement cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('confirmed', 'auto_confirmed') AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := now();
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.waves_settlement_notify() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_parties record;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- An import being undone cancels its settlements in bulk (waves_undo_import).
  -- The payee never saw a claim being made, so there is no withdrawal to tell
  -- them about: the activity row says the import was undone.
  IF NEW.import_batch_id IS NOT NULL
     AND current_setting('waves.undoing_import', true) = NEW.import_batch_id::text THEN
    RETURN NEW;
  END IF;

  -- Two members becoming one person (waves_fold_member_into): a payment
  -- between them is now a payment to oneself, and nobody is owed a word.
  IF NEW.status = 'cancelled'
     AND COALESCE(current_setting('waves.merging_member', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('confirmed', 'cancelled', 'disputed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_parties FROM public.waves_settlement_parties(NEW.id);

  IF NEW.status = 'confirmed' THEN
    -- Only the payee can confirm, so the payer is the one who learns something.
    PERFORM public.waves_notify(
      v_parties.payer_profile,
      v_parties.group_id,
      'settlement_confirmed',
      'Settled',
      COALESCE(v_parties.payee_name, 'They') || ' confirmed your payment',
      'waves://group/' || v_parties.group_id::text,
      jsonb_build_object(
        'settlementId', NEW.id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payer',
        'counterparty', v_parties.payee_name,
        'group', v_parties.group_name
      ),
      'settle_confirmed:' || NEW.id::text
    );

  ELSIF NEW.status = 'cancelled' THEN
    -- ADR-007: only the payer may cancel, and only while the claim is pending.
    -- The payee is the party whose pending "did you get it?" just disappeared,
    -- and a request that vanishes with no word is the thing this prevents.
    PERFORM public.waves_notify(
      v_parties.payee_profile,
      v_parties.group_id,
      'settlement_cancelled',
      'A payment claim was withdrawn',
      COALESCE(v_parties.payer_name, 'Someone') || ' took back what they said they paid',
      'waves://group/' || v_parties.group_id::text,
      jsonb_build_object(
        'settlementId', NEW.id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payee',
        'counterparty', v_parties.payer_name,
        'group', v_parties.group_name
      ),
      'settle_cancelled:' || NEW.id::text
    );

  ELSE
    -- Disputed. The payee's answer to a payment they never received, so the
    -- payer is the one who has to do something about it.
    PERFORM public.waves_notify(
      v_parties.payer_profile,
      v_parties.group_id,
      'settlement_disputed',
      'Your payment was not recognised',
      COALESCE(v_parties.payee_name, 'They') || ' say they did not receive it',
      'waves://group/' || v_parties.group_id::text,
      jsonb_build_object(
        'settlementId', NEW.id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payer',
        'counterparty', v_parties.payee_name,
        'group', v_parties.group_name
      ),
      'settle_disputed:' || NEW.id::text
    );
  END IF;

  RETURN NEW;
END
$$;

-- ──────────────────────────────────────────────────────────────── the fold ──

-- Everything filed under one member of a group, moved onto another member of
-- the same group. Internal: no caller check of its own, so it is granted to
-- nobody but service_role and reached only through the two functions below,
-- which have decided who may ask.
--
-- Per bill, one new version authored by `p_actor_member_id` — the member whose
-- say-so this was — with the placeholder's payers and shares re-pointed. Where
-- both people were already on the same bill, their two lines become one line
-- for the sum, so the version still adds up and the totals triggers stay
-- satisfied. Deleted bills are folded too: a restore within the window is just
-- another edit and must not bring the placeholder back.
CREATE FUNCTION public.waves_fold_member_into(
  p_from_member_id  uuid,
  p_into_member_id  uuid,
  p_actor_member_id uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_from        public.group_members%ROWTYPE;
  v_into        public.group_members%ROWTYPE;
  v_expense     record;
  v_version_id  uuid;
  v_version_no  integer;
  v_bills       integer := 0;
  v_moved       integer := 0;
  v_moved2      integer := 0;
  v_cancelled   integer := 0;
  v_comments    integer := 0;
BEGIN
  SELECT * INTO v_from FROM public.group_members WHERE id = p_from_member_id FOR UPDATE;
  SELECT * INTO v_into FROM public.group_members WHERE id = p_into_member_id FOR UPDATE;

  IF v_from.id IS NULL OR v_into.id IS NULL THEN
    RAISE EXCEPTION 'NO_SUCH_MEMBER' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_from.group_id <> v_into.group_id THEN
    RAISE EXCEPTION 'WRONG_GROUP: members of two groups cannot be folded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_from.id = v_into.id THEN
    RAISE EXCEPTION 'SAME_MEMBER' USING ERRCODE = 'check_violation';
  END IF;
  IF v_from.profile_id IS NOT NULL OR v_from.left_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_A_PLACEHOLDER: only a placeholder can be folded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_into.profile_id IS NULL OR v_into.left_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: can only fold into a member with an account'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Opens the one settlement transition the guard otherwise refuses, for this
  -- transaction only (see waves_settlement_transition).
  PERFORM set_config('waves.merging_member', 'on', true);

  FOR v_expense IN
    SELECT e.id, e.current_version_id
      FROM public.expenses e
      JOIN public.expense_versions ev ON ev.id = e.current_version_id
     WHERE e.group_id = v_from.group_id
       AND (
         EXISTS (SELECT 1 FROM public.expense_payers p
                  WHERE p.expense_version_id = ev.id AND p.member_id = v_from.id)
         OR EXISTS (SELECT 1 FROM public.expense_shares s
                     WHERE s.expense_version_id = ev.id AND s.member_id = v_from.id)
       )
     ORDER BY e.created_at
  LOOP
    SELECT COALESCE(max(version_no), 0) + 1 INTO v_version_no
      FROM public.expense_versions WHERE expense_id = v_expense.id;

    -- A copy of the live version, whatever columns it has, with the identity
    -- and authorship fields replaced: the fold must not silently drop a
    -- column added to versions after it was written.
    INSERT INTO public.expense_versions
    SELECT (jsonb_populate_record(
              NULL::public.expense_versions,
              to_jsonb(ev) || jsonb_build_object(
                'id', gen_random_uuid(),
                'version_no', v_version_no,
                'author_member_id', p_actor_member_id,
                'client_mutation_id', NULL,
                'import_batch_id', NULL,
                'created_at', now()
              )
           )).*
      FROM public.expense_versions ev
     WHERE ev.id = v_expense.current_version_id
    RETURNING id INTO v_version_id;

    INSERT INTO public.expense_payers (expense_version_id, member_id, amount)
    SELECT v_version_id,
           CASE WHEN p.member_id = v_from.id THEN v_into.id ELSE p.member_id END,
           sum(p.amount)
      FROM public.expense_payers p
     WHERE p.expense_version_id = v_expense.current_version_id
     GROUP BY 2;

    INSERT INTO public.expense_shares (expense_version_id, member_id, amount)
    SELECT v_version_id,
           CASE WHEN s.member_id = v_from.id THEN v_into.id ELSE s.member_id END,
           sum(s.amount)
      FROM public.expense_shares s
     WHERE s.expense_version_id = v_expense.current_version_id
     GROUP BY 2;

    UPDATE public.expenses SET current_version_id = v_version_id WHERE id = v_expense.id;
    v_bills := v_bills + 1;
  END LOOP;

  UPDATE public.expenses SET created_by = v_into.id
   WHERE group_id = v_from.group_id AND created_by = v_from.id;
  UPDATE public.expenses SET deleted_by = v_into.id
   WHERE group_id = v_from.group_id AND deleted_by = v_from.id;

  -- A payment between the two is a payment to oneself now.
  UPDATE public.settlements
     SET status = 'cancelled'
   WHERE group_id = v_from.group_id
     AND status <> 'cancelled'
     AND ((from_member_id = v_from.id AND to_member_id = v_into.id)
       OR (to_member_id = v_from.id AND from_member_id = v_into.id));
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- The rest point at the person. The cancelled ones above stay as they
  -- were: a settlement's two ends must differ, and a cancelled row counts for
  -- nothing.
  UPDATE public.settlements SET from_member_id = v_into.id
   WHERE group_id = v_from.group_id AND from_member_id = v_from.id
     AND to_member_id <> v_into.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  UPDATE public.settlements SET to_member_id = v_into.id
   WHERE group_id = v_from.group_id AND to_member_id = v_from.id
     AND from_member_id <> v_into.id;
  GET DIAGNOSTICS v_moved2 = ROW_COUNT;
  v_moved := v_moved + v_moved2;

  UPDATE public.expense_comments c SET author_member_id = v_into.id
    FROM public.expenses e
   WHERE e.id = c.expense_id AND e.group_id = v_from.group_id
     AND c.author_member_id = v_from.id;
  GET DIAGNOSTICS v_comments = ROW_COUNT;

  UPDATE public.expense_attachments a SET uploader_member_id = v_into.id
    FROM public.expenses e
   WHERE e.id = a.expense_id AND e.group_id = v_from.group_id
     AND a.uploader_member_id = v_from.id;

  UPDATE public.reminders SET from_member_id = v_into.id
   WHERE group_id = v_from.group_id AND from_member_id = v_from.id
     AND to_member_id <> v_into.id;
  UPDATE public.reminders SET to_member_id = v_into.id
   WHERE group_id = v_from.group_id AND to_member_id = v_from.id
     AND from_member_id <> v_into.id;

  -- Anybody still asking for the placeholder has lost it.
  UPDATE public.member_claims
     SET status = 'declined', decided_by = p_actor_member_id, decided_at = now()
   WHERE member_id = v_from.id AND status = 'pending';
  UPDATE public.member_link_requests
     SET status = 'cancelled', decided_at = now()
   WHERE member_id = v_from.id AND status = 'pending';

  -- Retired, not deleted: the activity log and the versions above still name
  -- it, and it keeps the name it was added under.
  UPDATE public.group_members
     SET left_at = now(),
         merged_into_member_id = v_into.id
   WHERE id = v_from.id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    v_from.group_id,
    p_actor_member_id,
    'merged',
    'member',
    v_from.id,
    jsonb_build_object(
      'from_name', v_from.ghost_name,
      'into_member_id', v_into.id,
      'bills', v_bills,
      'settlements', v_moved,
      'settlements_cancelled', v_cancelled
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bills', v_bills,
    'settlements', v_moved,
    'settlements_cancelled', v_cancelled,
    'comments', v_comments
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_fold_member_into(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_fold_member_into(uuid, uuid, uuid) TO service_role;

-- ───────────────────────────────────────── A. already in the group: merge ──

CREATE FUNCTION public.waves_merge_member_into(p_member_id uuid, p_into_member_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile  uuid := public.waves_current_profile_id();
  v_ghost    public.group_members%ROWTYPE;
  v_into     public.group_members%ROWTYPE;
  v_admin_id uuid;
  v_group    text;
  v_result   jsonb;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  SELECT * INTO v_ghost FROM public.group_members WHERE id = p_member_id FOR UPDATE;

  -- Not an admin of that group, or no such member: one answer, so this cannot
  -- be used to find out which ids exist.
  IF FOUND THEN
    SELECT id INTO v_admin_id
      FROM public.group_members
     WHERE group_id = v_ghost.group_id AND profile_id = v_profile
       AND role = 'admin' AND left_at IS NULL;
  END IF;
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  END IF;

  IF v_ghost.profile_id IS NOT NULL OR v_ghost.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_A_PLACEHOLDER');
  END IF;

  SELECT * INTO v_into FROM public.group_members WHERE id = p_into_member_id FOR UPDATE;
  IF NOT FOUND OR v_into.group_id <> v_ghost.group_id
     OR v_into.profile_id IS NULL OR v_into.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_IN_GROUP');
  END IF;
  IF public.waves_is_guest(v_into.profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'GUEST');
  END IF;

  v_result := public.waves_fold_member_into(v_ghost.id, v_into.id, v_admin_id);

  -- The person it went to is told, unless they are the one who did it.
  IF v_into.profile_id <> v_profile THEN
    SELECT name INTO v_group FROM public.groups WHERE id = v_ghost.group_id;
    PERFORM public.waves_notify(
      v_into.profile_id,
      v_ghost.group_id,
      'member_linked',
      'Everything under ' || COALESCE(v_ghost.ghost_name, 'a placeholder') || ' is yours now',
      'An admin of ' || COALESCE(v_group, 'the group') || ' said that was you.',
      '/group/' || v_ghost.group_id::text,
      jsonb_build_object('member_id', v_into.id, 'ghost_name', v_ghost.ghost_name, 'group_name', v_group),
      'member_linked:' || v_ghost.id::text
    );
  END IF;

  RETURN v_result || jsonb_build_object('member_id', v_into.id);
END
$$;

REVOKE ALL ON FUNCTION public.waves_merge_member_into(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_merge_member_into(uuid, uuid) TO authenticated, service_role;

-- ──────────────────────────────────────── B. not in the group: ask them ──

CREATE FUNCTION public.waves_request_member_link(p_member_id uuid, p_target_profile_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile   uuid := public.waves_current_profile_id();
  v_ghost     public.group_members%ROWTYPE;
  v_target    public.profiles%ROWTYPE;
  v_admin_id  uuid;
  v_own_id    uuid;
  v_id        uuid;
  v_group     text;
  v_me        text;
  v_today     integer;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  SELECT * INTO v_ghost FROM public.group_members WHERE id = p_member_id FOR UPDATE;
  IF FOUND THEN
    SELECT id INTO v_admin_id
      FROM public.group_members
     WHERE group_id = v_ghost.group_id AND profile_id = v_profile
       AND role = 'admin' AND left_at IS NULL;
  END IF;
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ALLOWED');
  END IF;

  IF v_ghost.profile_id IS NOT NULL OR v_ghost.left_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_A_PLACEHOLDER');
  END IF;

  -- Yourself: that is "This is me", which needs no asking.
  IF p_target_profile_id = v_profile THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'THAT_IS_YOU');
  END IF;

  -- The person must be real, with an account, and somebody the asker could
  -- already see: a group-mate, or a person who has chosen to be findable.
  -- Anything else is "nobody there", the same words as an id that does not
  -- exist, so the function is not an oracle for which ids do.
  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_profile_id;
  IF NOT FOUND
     OR NOT (
       public.waves_profiles_share_group(v_profile, p_target_profile_id)
       OR COALESCE(v_target.discoverable_by_phone, false)
       OR COALESCE(v_target.discoverable_by_email, false)
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF public.waves_is_guest(p_target_profile_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'GUEST');
  END IF;

  -- Already in the group as themselves: that is a merge, not an ask.
  SELECT id INTO v_own_id
    FROM public.group_members
   WHERE group_id = v_ghost.group_id AND profile_id = p_target_profile_id AND left_at IS NULL;
  IF v_own_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_IN_GROUP', 'member_id', v_own_id);
  END IF;

  SELECT id INTO v_id
    FROM public.member_link_requests
   WHERE member_id = v_ghost.id AND status = 'pending';
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'status', 'pending', 'request_id', v_id, 'already_pending', true);
  END IF;

  -- A ceiling on how many people one person can ask in a day, so this cannot
  -- be used to pepper strangers with cards.
  SELECT count(*) INTO v_today
    FROM public.member_link_requests
   WHERE requested_by = v_profile AND created_at > now() - interval '24 hours';
  IF v_today >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.member_link_requests (group_id, member_id, target_profile_id, requested_by)
  VALUES (v_ghost.group_id, v_ghost.id, p_target_profile_id, v_profile)
  RETURNING id INTO v_id;

  SELECT name INTO v_group FROM public.groups WHERE id = v_ghost.group_id;
  SELECT display_name INTO v_me FROM public.profiles WHERE id = v_profile;

  PERFORM public.waves_notify(
    p_target_profile_id,
    v_ghost.group_id,
    'member_link_requested',
    COALESCE(v_me, 'Someone') || ' says you are ' || COALESCE(v_ghost.ghost_name, 'someone listed')
      || ' in ' || COALESCE(v_group, 'a group'),
    'Accept to take that place and what is filed under it. Not you? Say so.',
    '/link-requests',
    jsonb_build_object(
      'request_id', v_id,
      'member_id', v_ghost.id,
      'ghost_name', v_ghost.ghost_name,
      'group_name', v_group,
      'requester_name', v_me
    ),
    'member_link:' || v_id::text
  );

  RETURN jsonb_build_object('ok', true, 'status', 'pending', 'request_id', v_id);
END
$$;

REVOKE ALL ON FUNCTION public.waves_request_member_link(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_request_member_link(uuid, uuid) TO authenticated, service_role;

-- The person asked answers. Accepting is the claim itself: they take the
-- placeholder row, history and all, the way an approved join claim does. If
-- they joined by another route while this waited, their own empty row is
-- retired first (one person, one member); if that row already has money on
-- it, the placeholder is folded into it instead.
CREATE FUNCTION public.waves_decide_member_link(p_request_id uuid, p_accept boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_req     public.member_link_requests%ROWTYPE;
  v_ghost   public.group_members%ROWTYPE;
  v_own     public.group_members%ROWTYPE;
  v_group   text;
  v_me      text;
  v_role    public."MemberRole" := 'member';
  v_moved   integer;
  v_member  uuid;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  SELECT * INTO v_req FROM public.member_link_requests WHERE id = p_request_id FOR UPDATE;
  -- Not yours to answer: the same words as a request that does not exist.
  IF NOT FOUND OR v_req.target_profile_id <> v_profile THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_REQUEST');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_DECIDED', 'status', v_req.status);
  END IF;

  SELECT name INTO v_group FROM public.groups WHERE id = v_req.group_id;
  SELECT display_name INTO v_me FROM public.profiles WHERE id = v_profile;
  SELECT * INTO v_ghost FROM public.group_members WHERE id = v_req.member_id FOR UPDATE;

  IF NOT p_accept THEN
    UPDATE public.member_link_requests
       SET status = 'declined', decided_at = now()
     WHERE id = p_request_id;

    PERFORM public.waves_notify(
      v_req.requested_by,
      v_req.group_id,
      'member_link_declined',
      COALESCE(v_me, 'They') || ' say they are not ' || COALESCE(v_ghost.ghost_name, 'that person'),
      COALESCE(v_ghost.ghost_name, 'The placeholder') || ' in ' || COALESCE(v_group, 'the group')
        || ' stays as it is.',
      '/group/' || v_req.group_id::text || '/member/' || v_req.member_id::text,
      jsonb_build_object('request_id', p_request_id, 'member_id', v_req.member_id,
                         'ghost_name', v_ghost.ghost_name, 'group_name', v_group),
      'member_link_declined:' || p_request_id::text
    );
    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  IF public.waves_is_guest(v_profile) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACCOUNT_REQUIRED');
  END IF;

  -- The place must still be free.
  IF v_ghost.id IS NULL OR v_ghost.profile_id IS NOT NULL OR v_ghost.left_at IS NOT NULL THEN
    UPDATE public.member_link_requests
       SET status = 'cancelled', decided_at = now()
     WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
  END IF;

  SELECT * INTO v_own
    FROM public.group_members
   WHERE group_id = v_req.group_id AND profile_id = v_profile AND left_at IS NULL
   FOR UPDATE;

  IF FOUND AND public.waves_member_has_history(v_own.id) THEN
    -- Already in with money on their own row: fold the placeholder into it.
    PERFORM public.waves_fold_member_into(v_ghost.id, v_own.id, v_own.id);
    v_member := v_own.id;
  ELSE
    IF FOUND THEN
      -- Joined meanwhile, nothing written: retire that row and take the
      -- placeholder, the way an approved join claim does (20260925120000).
      v_role := v_own.role;
      UPDATE public.group_members
         SET profile_id = NULL,
             ghost_name = COALESCE(NULLIF(btrim(v_me), ''), 'Member'),
             role = 'member',
             left_at = now()
       WHERE id = v_own.id;
    END IF;

    UPDATE public.group_members
       SET profile_id = v_profile,
           ghost_name = NULL,
           joined_via = 'link_request',
           role = CASE WHEN v_role = 'admin' THEN 'admin' ELSE role END
     WHERE id = v_ghost.id AND profile_id IS NULL AND left_at IS NULL;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CLAIMABLE');
    END IF;
    v_member := v_ghost.id;

    -- Anybody else waiting on the same place has lost it.
    UPDATE public.member_claims
       SET status = 'declined', decided_at = now()
     WHERE member_id = v_ghost.id AND status = 'pending';

    INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (
      v_req.group_id, v_ghost.id, 'claimed', 'member', v_ghost.id,
      jsonb_build_object('via', 'link_request', 'asked_by', v_req.requested_by)
    );
  END IF;

  UPDATE public.member_link_requests
     SET status = 'accepted', decided_at = now()
   WHERE id = p_request_id;

  PERFORM public.waves_notify(
    v_req.requested_by,
    v_req.group_id,
    'member_link_accepted',
    COALESCE(v_me, 'They') || ' confirmed they are ' || COALESCE(v_ghost.ghost_name, 'that person'),
    'Everything filed under that name in ' || COALESCE(v_group, 'the group') || ' is theirs now.',
    '/group/' || v_req.group_id::text,
    jsonb_build_object('request_id', p_request_id, 'member_id', v_member,
                       'ghost_name', v_ghost.ghost_name, 'group_name', v_group),
    'member_link_accepted:' || p_request_id::text
  );

  RETURN jsonb_build_object('ok', true, 'status', 'accepted', 'member_id', v_member);
END
$$;

REVOKE ALL ON FUNCTION public.waves_decide_member_link(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_decide_member_link(uuid, boolean) TO authenticated, service_role;

-- The asker, or any admin of the group, takes the ask back.
CREATE FUNCTION public.waves_cancel_member_link(p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_req     public.member_link_requests%ROWTYPE;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;

  SELECT * INTO v_req FROM public.member_link_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT (
    v_req.requested_by = v_profile
    OR EXISTS (
      SELECT 1 FROM public.group_members gm
       WHERE gm.group_id = v_req.group_id AND gm.profile_id = v_profile
         AND gm.role = 'admin' AND gm.left_at IS NULL
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SUCH_REQUEST');
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ALREADY_DECIDED', 'status', v_req.status);
  END IF;

  UPDATE public.member_link_requests
     SET status = 'cancelled', decided_at = now()
   WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
END
$$;

REVOKE ALL ON FUNCTION public.waves_cancel_member_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_cancel_member_link(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────── reading ──

-- What an admin of this group has asked and is still waiting on.
CREATE FUNCTION public.waves_group_member_links(p_group_id uuid)
RETURNS TABLE(
  id            uuid,
  member_id     uuid,
  target_id     uuid,
  target_name   text,
  target_avatar text,
  created_at    timestamp with time zone
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT r.id, r.member_id, r.target_profile_id, p.display_name, p.avatar_url, r.created_at
    FROM public.member_link_requests r
    JOIN public.profiles p ON p.id = r.target_profile_id
   WHERE r.group_id = p_group_id
     AND r.status = 'pending'
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.role = 'admin'
          AND gm.left_at IS NULL
     )
   ORDER BY r.created_at;
$$;

REVOKE ALL ON FUNCTION public.waves_group_member_links(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_member_links(uuid) TO authenticated, service_role;

-- The asks waiting on me: the card on the home screen.
CREATE FUNCTION public.waves_my_member_links()
RETURNS TABLE(
  id             uuid,
  group_id       uuid,
  group_name     text,
  member_id      uuid,
  ghost_name     text,
  requester_name text,
  created_at     timestamp with time zone
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT r.id, r.group_id, g.name, r.member_id, m.ghost_name, p.display_name, r.created_at
    FROM public.member_link_requests r
    JOIN public.groups g        ON g.id = r.group_id
    JOIN public.group_members m ON m.id = r.member_id
    JOIN public.profiles p      ON p.id = r.requested_by
   WHERE r.target_profile_id = public.waves_current_profile_id()
     AND r.status = 'pending'
     AND g.deleted_at IS NULL
   ORDER BY r.created_at;
$$;

REVOKE ALL ON FUNCTION public.waves_my_member_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_member_links() TO authenticated, service_role;

-- Who "Renny" could be: the people the caller already shares a group with,
-- less the ones already in this group as themselves, guests, and the caller.
-- Nothing is shown here that the caller could not already see on a member
-- list; a person outside their groups is found by phone or email through
-- `waves_find_person`, under that person's own discovery settings.
CREATE FUNCTION public.waves_member_link_candidates(p_group_id uuid)
RETURNS TABLE(
  profile_id   uuid,
  display_name text,
  avatar_url   text
)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT ON (p.id) p.id, p.display_name, p.avatar_url
    FROM public.group_members mine
    JOIN public.group_members theirs
      ON theirs.group_id = mine.group_id
     AND theirs.profile_id IS NOT NULL
     AND theirs.left_at IS NULL
     AND theirs.profile_id <> mine.profile_id
    JOIN public.profiles p ON p.id = theirs.profile_id
   WHERE mine.profile_id = public.waves_current_profile_id()
     AND mine.left_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = p_group_id
          AND gm.profile_id = public.waves_current_profile_id()
          AND gm.left_at IS NULL
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.group_members here
        WHERE here.group_id = p_group_id
          AND here.profile_id = p.id
          AND here.left_at IS NULL
     )
     AND NOT public.waves_is_guest(p.id)
   ORDER BY p.id, p.display_name
   LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.waves_member_link_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_member_link_candidates(uuid) TO authenticated, service_role;

-- ──────────────────────────────────────────── the new words, under a switch ──

-- Push for the four new kinds follows the "involves me" switch, as every
-- claim notice does.
CREATE OR REPLACE FUNCTION public.waves_pref_key_for_kind(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE p_kind
    WHEN 'expense_added'             THEN 'involvesMe'
    WHEN 'expense_edited'            THEN 'involvesMe'
    WHEN 'expense_deleted'           THEN 'involvesMe'
    WHEN 'you_owe'                   THEN 'involvesMe'
    WHEN 'expense_disputed'          THEN 'involvesMe'
    WHEN 'expense_dispute_resolved'  THEN 'involvesMe'
    WHEN 'ghost_claimed'             THEN 'involvesMe'
    WHEN 'ghost_claim_requested'     THEN 'involvesMe'
    WHEN 'ghost_claim_approved'      THEN 'involvesMe'
    WHEN 'ghost_claim_declined'      THEN 'involvesMe'
    WHEN 'member_link_requested'     THEN 'involvesMe'
    WHEN 'member_link_accepted'      THEN 'involvesMe'
    WHEN 'member_link_declined'      THEN 'involvesMe'
    WHEN 'member_linked'             THEN 'involvesMe'
    WHEN 'group_invite_accepted'     THEN 'involvesMe'
    WHEN 'group_added'               THEN 'involvesMe'
    WHEN 'settlement_initiated'      THEN 'settlementRequests'
    WHEN 'settlement_confirm_request' THEN 'settlementRequests'
    WHEN 'settlement_confirmed'      THEN 'settlementRequests'
    WHEN 'settlement_cancelled'      THEN 'settlementRequests'
    WHEN 'settlement_disputed'       THEN 'settlementRequests'
    WHEN 'nudge'                     THEN 'nudges'
    WHEN 'trip_nudge_morning'        THEN 'nudges'
    WHEN 'trip_nudge_evening'        THEN 'nudges'
    WHEN 'digest_daily'              THEN 'groupActivityDigest'
    WHEN 'digest_weekly'             THEN 'groupActivityDigest'
    WHEN 'group_import'              THEN 'involvesMe'
    ELSE NULL
  END;
$$;
