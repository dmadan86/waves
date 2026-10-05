-- Editable time-of-day for an expense.
--
-- `expense_date` stays the source of truth for the day. `occurred_at` is the
-- exact moment the person chose (a UTC instant; the app renders it in local
-- time). Nullable: every existing row, and every expense written by an app
-- build that predates this, has none and falls back to the save time.
--
-- Versioned like every other field of an expense, so it lives on
-- `expense_versions`.

ALTER TABLE public.expense_versions ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

-- `waves_apply_expense` gains `p_occurred_at` as its LAST parameter, defaulted
-- to NULL, so a caller sending the old named arguments still resolves. The
-- signature changes, so the old one is dropped explicitly: a bare CREATE OR
-- REPLACE would leave two overloads and make old callers hit "not unique".
-- Everything else is the previous definition (20261003120000) unchanged.

DROP FUNCTION IF EXISTS public.waves_apply_expense(
  uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid,
  text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date
);

CREATE FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text DEFAULT NULL::text, p_receipt_id uuid DEFAULT NULL::uuid, p_base_version_no integer DEFAULT NULL::integer, p_fx jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'manual'::text, p_payment_method text DEFAULT NULL::text, p_receipt_share_url text DEFAULT NULL::text, p_category_meta jsonb DEFAULT NULL::jsonb, p_location jsonb DEFAULT NULL::jsonb, p_sub_event_id text DEFAULT NULL::text, p_is_deposit boolean DEFAULT false, p_balance_due_minor bigint DEFAULT NULL::bigint, p_balance_due_date date DEFAULT NULL::date, p_occurred_at timestamptz DEFAULT NULL::timestamptz) RETURNS jsonb
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
  END IF;

  IF p_balance_due_minor IS NOT NULL AND p_balance_due_minor < 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a balance due is zero or more'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.expense_versions
    (expense_id, version_no, author_member_id, description, category, category_meta, expense_date,
     currency, amount, split_type, split_params, receipt_id, notes, payment_method,
     receipt_share_url, location, client_mutation_id, fx, source,
     sub_event_id, is_deposit, balance_due_minor, balance_due_date, occurred_at)
  VALUES
    (p_expense_id, v_version_no, p_author_member_id, p_description, p_category, p_category_meta, p_expense_date,
     upper(p_currency), p_amount, p_split_type::"SplitType", p_split_params, p_receipt_id,
     p_notes, p_payment_method, p_receipt_share_url, p_location, p_client_mutation_id, p_fx,
     COALESCE(p_source, 'manual')::"ExpenseSource",
     p_sub_event_id, COALESCE(p_is_deposit, false), p_balance_due_minor, p_balance_due_date, v_occurred_at)
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

REVOKE ALL ON FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text, p_receipt_id uuid, p_base_version_no integer, p_fx jsonb, p_source text, p_payment_method text, p_receipt_share_url text, p_category_meta jsonb, p_location jsonb, p_sub_event_id text, p_is_deposit boolean, p_balance_due_minor bigint, p_balance_due_date date, p_occurred_at timestamptz) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text, p_receipt_id uuid, p_base_version_no integer, p_fx jsonb, p_source text, p_payment_method text, p_receipt_share_url text, p_category_meta jsonb, p_location jsonb, p_sub_event_id text, p_is_deposit boolean, p_balance_due_minor bigint, p_balance_due_date date, p_occurred_at timestamptz) TO service_role;
