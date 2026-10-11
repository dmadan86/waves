-- "Paid to": who outside the group an expense's money went to.
--
-- A Home group's rent goes to a landlord, the car to a rental firm, the maid's
-- wages to the maid. None of them is a member, so none of them belongs in the
-- payers or the shares: this is a free-text label on the VERSION (so an edit is
-- versioned and shows in History), optional, never part of a balance, and
-- available in every group type.
--
-- Nullable: every existing row, and every expense written by an app build that
-- predates this, has none.

ALTER TABLE public.expense_versions ADD COLUMN IF NOT EXISTS payee text;

-- Stored trimmed and non-blank, at most 80 characters. `waves_apply_expense`
-- normalises before inserting, so this only ever refuses a payee that is
-- simply too long.
ALTER TABLE public.expense_versions
  ADD CONSTRAINT expense_versions_payee_check
  CHECK (payee IS NULL OR (char_length(payee) BETWEEN 1 AND 80 AND payee = btrim(payee)));

-- `waves_apply_expense` gains `p_payee` as its LAST parameter, defaulted to
-- NULL, so a caller sending the old named arguments still resolves. NULL means
-- "not sent": an edit carries the current version's payee forward, so an older
-- app editing an expense cannot wipe it. '' means "cleared". The signature
-- changes, so the old one is dropped explicitly: a bare CREATE OR REPLACE would
-- leave two overloads and make old callers hit "not unique". Everything else is
-- the previous definition (20261006130000) unchanged.

DROP FUNCTION IF EXISTS public.waves_apply_expense(
  uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid,
  text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date,
  timestamptz
);

CREATE FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text DEFAULT NULL::text, p_receipt_id uuid DEFAULT NULL::uuid, p_base_version_no integer DEFAULT NULL::integer, p_fx jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'manual'::text, p_payment_method text DEFAULT NULL::text, p_receipt_share_url text DEFAULT NULL::text, p_category_meta jsonb DEFAULT NULL::jsonb, p_location jsonb DEFAULT NULL::jsonb, p_sub_event_id text DEFAULT NULL::text, p_is_deposit boolean DEFAULT false, p_balance_due_minor bigint DEFAULT NULL::bigint, p_balance_due_date date DEFAULT NULL::date, p_occurred_at timestamptz DEFAULT NULL::timestamptz, p_payee text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_existing        RECORD;
  v_version_no      int;
  v_version_id      uuid;
  v_is_new          boolean := false;
  v_row             jsonb;
  v_unknown         int;
  v_conflict        boolean := false;
  v_superseded_no   int;
  v_superseded_by   uuid;
  v_superseded_desc text;
  v_group_currency  char(3);
  v_actor_name      text;
  v_group_name      text;
  v_recipient       RECORD;
  v_occurred_at     timestamptz := p_occurred_at;
  v_payee           text := p_payee;
BEGIN
  -- This function is SECURITY DEFINER: verify the caller is a live member of the
  -- group before it moves a balance (security hardening).
  PERFORM public.waves_assert_expense_caller(p_group_id, p_author_member_id);

  -- Replay of a mutation we already applied (ADR-005).
  IF p_client_mutation_id IS NOT NULL THEN
    SELECT ev.id, ev.expense_id, ev.version_no INTO v_existing
    FROM public.expense_versions ev
    WHERE ev.client_mutation_id = p_client_mutation_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'expenseId', v_existing.expense_id,
        'versionId', v_existing.id,
        'versionNo', v_existing.version_no,
        'replayed', true
      );
    END IF;
  END IF;

  -- A rate that converts the wrong way is worse than no rate: it converts
  -- confidently and wrongly. Checked before a single row is written.
  SELECT g.default_currency INTO v_group_currency FROM public.groups g WHERE g.id = p_group_id;
  PERFORM public.waves_assert_fx_valid(p_fx, upper(p_currency)::char(3), v_group_currency);

  -- Every member referenced must belong to this group; a caller cannot smuggle
  -- in somebody else's member id (ADR-013).
  SELECT count(*) INTO v_unknown
  FROM (
    SELECT (value ->> 'memberId')::uuid AS member_id FROM jsonb_array_elements(p_payers)
    UNION
    SELECT (value ->> 'memberId')::uuid FROM jsonb_array_elements(p_shares)
    UNION
    SELECT p_author_member_id
  ) referenced
  WHERE referenced.member_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.id = referenced.member_id AND gm.group_id = p_group_id
    );
  IF v_unknown > 0 THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: % member(s) are not in this group', v_unknown
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_expense_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.expenses WHERE id = p_expense_id) THEN
    v_is_new := true;
    INSERT INTO public.expenses (id, group_id, created_by)
    VALUES (COALESCE(p_expense_id, gen_random_uuid()), p_group_id, p_author_member_id)
    RETURNING id INTO p_expense_id;
    v_version_no := 1;
  ELSE
    IF (SELECT group_id FROM public.expenses WHERE id = p_expense_id) <> p_group_id THEN
      RAISE EXCEPTION 'WRONG_GROUP: that expense belongs to another group'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(max(version_no), 0) + 1 INTO v_version_no
    FROM public.expense_versions WHERE expense_id = p_expense_id;

    -- Somebody else wrote a version after the one this client was looking at.
    -- Append-only means both survive; the later receipt — this one — wins.
    IF p_base_version_no IS NOT NULL AND p_base_version_no < v_version_no - 1 THEN
      v_conflict := true;
      SELECT ev.version_no, ev.author_member_id, ev.description
        INTO v_superseded_no, v_superseded_by, v_superseded_desc
        FROM public.expense_versions ev
        JOIN public.expenses e ON e.id = ev.expense_id AND e.current_version_id = ev.id
       WHERE ev.expense_id = p_expense_id;
    END IF;

    -- A client that predates the time-of-day field sends no `p_occurred_at`.
    -- On an edit that must not wipe the time an earlier version carries, so it
    -- is carried forward from the current version, unless the edit moved the
    -- day (an old client changed the date, so the old time no longer fits it).
    -- A new expense stays NULL.
    IF v_occurred_at IS NULL THEN
      SELECT ev.occurred_at INTO v_occurred_at
        FROM public.expense_versions ev
        JOIN public.expenses e ON e.id = ev.expense_id AND e.current_version_id = ev.id
       WHERE ev.expense_id = p_expense_id
         AND ev.expense_date = p_expense_date;
    END IF;

    -- "Paid to" follows the same rule without the day condition: a client that
    -- predates it sends no `p_payee`, and an edit from it must not wipe the
    -- payee somebody set on a newer phone. A newer client clears it with ''.
    IF v_payee IS NULL THEN
      SELECT ev.payee INTO v_payee
        FROM public.expense_versions ev
        JOIN public.expenses e ON e.id = ev.expense_id AND e.current_version_id = ev.id
       WHERE ev.expense_id = p_expense_id;
    END IF;
  END IF;

  -- Blank is "none". Inner runs of whitespace collapse to one space, so
  -- "Car  rental" and "Car rental" are the same payee in the suggestions. The
  -- length is left to the column's CHECK: a payee over 80 characters is
  -- refused, not silently cut.
  v_payee := NULLIF(btrim(regexp_replace(v_payee, '\s+', ' ', 'g')), '');

  IF p_balance_due_minor IS NOT NULL AND p_balance_due_minor < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a balance due is zero or more'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.expense_versions
    (expense_id, version_no, author_member_id, description, category, category_meta, expense_date,
     currency, amount, split_type, split_params, receipt_id, notes, payment_method,
     receipt_share_url, location, client_mutation_id, fx, source,
     sub_event_id, is_deposit, balance_due_minor, balance_due_date, occurred_at, payee)
  VALUES
    (p_expense_id, v_version_no, p_author_member_id, p_description, p_category, p_category_meta, p_expense_date,
     upper(p_currency), p_amount, p_split_type::"SplitType", p_split_params, p_receipt_id,
     p_notes, p_payment_method, p_receipt_share_url, p_location, p_client_mutation_id, p_fx,
     COALESCE(p_source, 'manual')::"ExpenseSource",
     p_sub_event_id, COALESCE(p_is_deposit, false), p_balance_due_minor, p_balance_due_date, v_occurred_at, v_payee)
  RETURNING id INTO v_version_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payers) LOOP
    INSERT INTO public.expense_payers (expense_version_id, member_id, amount)
    VALUES (v_version_id, (v_row ->> 'memberId')::uuid, (v_row ->> 'amount')::bigint);
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_shares) LOOP
    INSERT INTO public.expense_shares (expense_version_id, member_id, amount)
    VALUES (v_version_id, (v_row ->> 'memberId')::uuid, (v_row ->> 'amount')::bigint);
  END LOOP;

  -- Pointing at the new version is what makes the edit live.
  UPDATE public.expenses SET current_version_id = v_version_id WHERE id = p_expense_id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    p_group_id, p_author_member_id,
    CASE WHEN v_is_new THEN 'added' ELSE 'edited' END,
    'expense', p_expense_id,
    jsonb_build_object(
      'description', p_description,
      'amount', p_amount::text,
      'currency', upper(p_currency),
      'versionNo', v_version_no,
      'source', COALESCE(p_source, 'manual')
    )
  );

  -- A second entry, so the person whose edit lost can find it. Their version is
  -- still in `expense_versions` and restoring it is just another edit.
  IF v_conflict THEN
    INSERT INTO public.activity_log
      (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (
      p_group_id, p_author_member_id, 'superseded', 'expense', p_expense_id,
      jsonb_build_object(
        'supersededVersionNo', v_superseded_no,
        'supersededAuthorMemberId', v_superseded_by,
        'supersededDescription', v_superseded_desc,
        'baseVersionNo', p_base_version_no,
        'winningVersionNo', v_version_no
      )
    );
  END IF;

  -- ── the people on a new bill hear about it ─────────────────────────────
  --
  -- Everyone who paid towards it or owes a share of it, except whoever wrote
  -- it: they know. Not a ghost (no one to tell — `waves_notify` returns NULL
  -- for them anyway), not somebody who has left the group, and not a member
  -- whose share is zero, who is on the bill in name only.
  --
  -- New bills only. An edit is a different sentence (`expense_edited`) and is
  -- not sent from here yet. A Splitwise import writes hundreds of old bills in
  -- one go; buzzing the whole group once per row of somebody's history is not
  -- news, so `imported` never notifies.
  --
  -- The dedupe key is the expense and the recipient, so the offline queue
  -- replaying this mutation cannot buzz anyone twice — and a replay returns
  -- above, before it gets here, in any case. Whether it is then *pushed* is the
  -- recipient's call: `expense_added` sits under the "involves me" switch
  -- (`waves_pref_key_for_kind`), read at claim time.
  --
  -- Deliberately last: `waves_notify` is an INSERT with ON CONFLICT DO NOTHING,
  -- and nothing about telling people may cost the bill itself.
  IF v_is_new AND COALESCE(p_source, 'manual') <> 'imported' THEN
    SELECT COALESCE(p.display_name, m.ghost_name) INTO v_actor_name
      FROM public.group_members m
      LEFT JOIN public.profiles p ON p.id = m.profile_id
     WHERE m.id = p_author_member_id;

    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = p_group_id;

    FOR v_recipient IN
      SELECT DISTINCT m.profile_id
        FROM (
          SELECT (value ->> 'memberId')::uuid AS member_id, (value ->> 'amount')::bigint AS amount
            FROM jsonb_array_elements(p_payers)
          UNION ALL
          SELECT (value ->> 'memberId')::uuid, (value ->> 'amount')::bigint
            FROM jsonb_array_elements(p_shares)
        ) involved
        JOIN public.group_members m ON m.id = involved.member_id
       WHERE involved.amount <> 0
         AND m.profile_id IS NOT NULL
         AND m.left_at IS NULL
         AND m.id IS DISTINCT FROM p_author_member_id
         -- The same person under another member row (a claimed ghost) is still
         -- the author.
         AND m.profile_id IS DISTINCT FROM (
           SELECT a.profile_id FROM public.group_members a WHERE a.id = p_author_member_id
         )
    LOOP
      PERFORM public.waves_notify(
        v_recipient.profile_id,
        p_group_id,
        'expense_added',
        COALESCE(v_actor_name, 'Someone') || ' added an expense',
        COALESCE(NULLIF(btrim(p_description), ''), 'An expense')
          || ' in ' || COALESCE(v_group_name, 'your group'),
        'waves://group/' || p_group_id::text || '/expense/' || p_expense_id::text,
        jsonb_build_object(
          'counterparty', v_actor_name,
          'group', v_group_name,
          'description', NULLIF(btrim(p_description), ''),
          'amount', p_amount::text,
          'currency', upper(p_currency),
          'expenseId', p_expense_id
        ),
        'expense_added:' || p_expense_id::text || ':' || v_recipient.profile_id::text
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'expenseId', p_expense_id,
    'versionId', v_version_id,
    'versionNo', v_version_no,
    'replayed', false,
    'superseded', v_conflict,
    'supersededVersionNo', v_superseded_no
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text, p_receipt_id uuid, p_base_version_no integer, p_fx jsonb, p_source text, p_payment_method text, p_receipt_share_url text, p_category_meta jsonb, p_location jsonb, p_sub_event_id text, p_is_deposit boolean, p_balance_due_minor bigint, p_balance_due_date date, p_occurred_at timestamptz, p_payee text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text, p_receipt_id uuid, p_base_version_no integer, p_fx jsonb, p_source text, p_payment_method text, p_receipt_share_url text, p_category_meta jsonb, p_location jsonb, p_sub_event_id text, p_is_deposit boolean, p_balance_due_minor bigint, p_balance_due_date date, p_occurred_at timestamptz, p_payee text) TO service_role;

-- The ledger import passes a row's `payee` through when its file carries one.
-- Same signature, so CREATE OR REPLACE keeps the function's identity; the
-- caller model is restated anyway. Otherwise the baseline definition unchanged.

CREATE OR REPLACE FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb DEFAULT '[]'::jsonb, p_origin text DEFAULT 'splitwise'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id  uuid := public.waves_current_profile_id();
  v_author      uuid;
  v_person      jsonb;
  v_expense     jsonb;
  v_settlement  jsonb;
  v_name        text;
  v_member      uuid;
  v_names       jsonb := '{}'::jsonb;   -- name -> member id, as text
  v_payers      jsonb;
  v_shares      jsonb;
  v_entry       record;
  v_created     int := 0;
  v_ghosts      int := 0;
  v_settled     int := 0;
  v_pending     int := 0;
  v_mutation    uuid;
  v_result      jsonb;
  v_from        uuid;
  v_to          uuid;
  v_from_real   boolean;
  v_to_real     boolean;
  v_file_status text;
  v_status      "SettlementStatus";
  v_at          timestamptz;
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_author := public.waves_my_member_id_for(p_group_id, v_profile_id);

  IF jsonb_typeof(p_people) <> 'array' OR jsonb_array_length(p_people) = 0 THEN
    RAISE EXCEPTION 'NO_PEOPLE: the import named nobody' USING ERRCODE = 'check_violation';
  END IF;

  -- Resolve every name to a member of this group up front, so an unmappable
  -- one fails before a single row is written.
  FOR v_person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    v_name := btrim(COALESCE(v_person ->> 'name', ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'NO_PEOPLE: somebody in the file has no name'
        USING ERRCODE = 'check_violation';
    END IF;

    IF (v_person ->> 'memberId') IS NOT NULL THEN
      SELECT gm.id INTO v_member
        FROM public.group_members gm
       WHERE gm.id = (v_person ->> 'memberId')::uuid AND gm.group_id = p_group_id;
      IF v_member IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_MEMBER: % is not in this group', v_name
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    ELSE
      INSERT INTO public.group_members (group_id, ghost_name, joined_via)
      VALUES (p_group_id, v_name, 'ghost')
      RETURNING id INTO v_member;
      v_ghosts := v_ghosts + 1;
    END IF;

    v_names := v_names || jsonb_build_object(v_name, v_member::text);
  END LOOP;

  FOR v_expense IN SELECT * FROM jsonb_array_elements(p_expenses) LOOP
    -- Names become member ids here rather than on the client, so the client
    -- never gets to choose which member a row lands on.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'memberId', v_names ->> entry.key,
             'amount',   entry.value #>> '{}'
           )), '[]'::jsonb)
      INTO v_payers
      FROM jsonb_each(v_expense -> 'payers') AS entry;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'memberId', v_names ->> entry.key,
             'amount',   entry.value #>> '{}'
           )), '[]'::jsonb)
      INTO v_shares
      FROM jsonb_each(v_expense -> 'shares') AS entry;

    FOR v_entry IN
      SELECT key FROM jsonb_each(v_expense -> 'shares')
      UNION
      SELECT key FROM jsonb_each(v_expense -> 'payers')
    LOOP
      IF (v_names ->> v_entry.key) IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_MEMBER: "%" appears in an expense but not in the people list',
          v_entry.key USING ERRCODE = 'foreign_key_violation';
      END IF;
    END LOOP;

    v_result := public.waves_apply_expense(
      p_group_id           => p_group_id,
      p_expense_id         => NULL,
      p_author_member_id   => v_author,
      p_description        => COALESCE(v_expense ->> 'description', 'Imported expense'),
      p_category           => v_expense ->> 'category',
      p_expense_date       => (v_expense ->> 'date')::date,
      p_currency           => upper(COALESCE(v_expense ->> 'currency', 'INR'))::char(3),
      p_amount             => (v_expense ->> 'amount')::bigint,
      -- 'exact' regardless of how the split was originally expressed: the
      -- participants are new members with new ids, so a percentage or a set of
      -- weights would have to be re-divided and could land a paisa somewhere
      -- the file did not. The amounts are the amounts — and with an exact
      -- split the shares ARE the split params, so there is nothing for the
      -- server to recompute; `waves_check_expense_totals` still refuses a
      -- version whose payers or shares do not sum to the amount.
      p_split_type         => 'exact',
      p_split_params       => jsonb_build_object('kind', 'exact', 'amounts', (
        SELECT COALESCE(jsonb_object_agg(v_names ->> entry.key, entry.value), '{}'::jsonb)
          FROM jsonb_each(v_expense -> 'shares') AS entry
      )),
      p_payers             => v_payers,
      p_shares             => v_shares,
      p_client_mutation_id => (v_expense ->> 'clientMutationId')::uuid,
      p_source             => 'imported',
      -- "Paid to", when the file has one. Absent (a Splitwise CSV has no such
      -- column) is NULL, which on a new expense is simply none.
      p_payee              => v_expense ->> 'payee'
    );

    -- A replayed row is one this import already wrote — a second tap, or a lost
    -- response. Not an error, and not a second copy either (ADR-005).
    IF COALESCE((v_result ->> 'replayed')::boolean, false) = false THEN
      v_created := v_created + 1;
    END IF;
  END LOOP;

  FOR v_settlement IN SELECT * FROM jsonb_array_elements(p_settlements) LOOP
    IF (v_names ->> (v_settlement ->> 'from')) IS NULL
       OR (v_names ->> (v_settlement ->> 'to')) IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_MEMBER: a settlement names somebody who is not in the people list'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    v_from := (v_names ->> (v_settlement ->> 'from'))::uuid;
    v_to   := (v_names ->> (v_settlement ->> 'to'))::uuid;

    v_mutation := (v_settlement ->> 'clientMutationId')::uuid;
    -- Same idempotency rule as the expenses: a replayed import must not pay
    -- somebody twice.
    CONTINUE WHEN v_mutation IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.settlements s WHERE s.client_mutation_id = v_mutation
    );

    -- The file's word on the row, before anybody's consent is considered. A
    -- status the ledger has no name for is refused rather than cast blind.
    v_file_status := lower(COALESCE(v_settlement ->> 'status', 'confirmed'));
    IF v_file_status NOT IN ('confirmed', 'auto_confirmed', 'initiated', 'disputed', 'cancelled') THEN
      RAISE EXCEPTION 'INVALID_STATUS: a settlement cannot be imported as "%"', v_file_status
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT gm.profile_id IS NOT NULL INTO v_from_real
      FROM public.group_members gm WHERE gm.id = v_from;
    SELECT gm.profile_id IS NOT NULL INTO v_to_real
      FROM public.group_members gm WHERE gm.id = v_to;

    IF v_file_status IN ('confirmed', 'auto_confirmed') THEN
      -- Settled, says the file. It stays settled only if the person doing the
      -- import can vouch for the receipt: they are the payee, or the payee is
      -- a ghost and the payer is nobody else on Waves. Otherwise the member it
      -- names gets to confirm it, the way they would any settle-up (ADR-007).
      IF v_to = v_author OR (NOT v_to_real AND (v_from = v_author OR NOT v_from_real)) THEN
        v_status := 'confirmed';
      ELSE
        v_status := 'initiated';
      END IF;
    ELSE
      v_status := v_file_status::"SettlementStatus";
    END IF;

    -- A confirmed row keeps the file's date. A pending one is dated now, so the
    -- auto-confirm window starts when the people on Waves can first see it —
    -- not years ago in the file.
    v_at := CASE
      WHEN v_status = 'initiated' THEN now()
      ELSE COALESCE((v_settlement ->> 'at')::timestamptz, now())
    END;

    INSERT INTO public.settlements
      (group_id, from_member_id, to_member_id, currency, amount, method, status, note,
       initiated_at, confirmed_at, client_mutation_id)
    VALUES (
      p_group_id,
      v_from,
      v_to,
      upper(COALESCE(v_settlement ->> 'currency', 'INR'))::char(3),
      (v_settlement ->> 'amount')::bigint,
      COALESCE(v_settlement ->> 'method', 'other')::"SettlementMethod",
      v_status,
      v_settlement ->> 'note',
      v_at,
      CASE WHEN v_status = 'confirmed' THEN v_at END,
      v_mutation
    );

    IF v_status = 'initiated' THEN
      v_pending := v_pending + 1;
    END IF;
    v_settled := v_settled + 1;
  END LOOP;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    p_group_id, v_author, 'imported', 'group', p_group_id,
    jsonb_build_object(
      'expenses', v_created, 'ghosts', v_ghosts, 'settlements', v_settled,
      'settlementsPending', v_pending, 'from', p_origin
    )
  );

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'expenses', v_created,
    'ghosts', v_ghosts,
    'settlements', v_settled,
    'settlementsPending', v_pending,
    'members', v_names
  );
END
$$;


--
-- Name: waves_import_splitwise(uuid, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_origin text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_origin text) TO authenticated;
GRANT ALL ON FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_origin text) TO service_role;
