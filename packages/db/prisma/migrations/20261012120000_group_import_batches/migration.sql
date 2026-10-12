-- Importing into a group that already exists: batches, undo, and a chunked RPC.
--
-- Until now an import could only ever build a NEW group (`waves_import_ledger`
-- is reachable for an existing one, but nothing tied the rows it wrote
-- together, so a wrong column mapping in a shared group could only be fixed by
-- deleting hundreds of expenses by hand while everyone else's balances were
-- wrong). This migration adds the three things a bulk write into somebody
-- else's ledger needs:
--
--   * a BATCH: one id, chosen by the client, that every row of one import
--     carries. It is the idempotency key for the whole import and the handle
--     "Undo import" uses;
--   * an UNDO (`waves_undo_import`), inside 24 hours, refused once any imported
--     expense has been edited or any imported settlement has moved on;
--   * a CHUNKED RPC (`waves_import_into_group`): the phone sends 250 rows at a
--     time under one batch id, each chunk atomic, a retry a replay.
--
-- `waves_import_ledger` keeps its signature and its behaviour; its body is now
-- the internal `waves_import_rows`, shared with the new RPC. See
-- docs/plans/group-import (the plan) §6.

-- ───────────────────────────────────────────────────── the batch itself ──

CREATE TABLE public.import_batches (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    actor_member_id uuid,
    source text NOT NULL,
    expense_count integer DEFAULT 0 NOT NULL,
    settlement_count integer DEFAULT 0 NOT NULL,
    ghost_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    undone_at timestamp with time zone,
    undone_by uuid,
    CONSTRAINT import_batches_source_known CHECK (source = ANY (ARRAY['csv'::text, 'splitwise'::text, 'waves_csv'::text, 'waves_json'::text, 'xlsx'::text, 'screenshot'::text])),
    CONSTRAINT import_batches_counts_nonneg CHECK (expense_count >= 0 AND settlement_count >= 0 AND ghost_count >= 0)
);

COMMENT ON TABLE public.import_batches IS 'One import into a group: the id every imported row carries, and what Undo import acts on. Written only by waves_import_into_group / waves_undo_import.';

ALTER TABLE ONLY public.import_batches ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_actor_member_id_fkey FOREIGN KEY (actor_member_id)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_undone_by_fkey FOREIGN KEY (undone_by)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX import_batches_group_id_created_at_idx ON public.import_batches USING btree (group_id, created_at);

-- Members of the group can see its batches (so a phone can offer Undo); every
-- write goes through the definer functions below.
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_batches_select ON public.import_batches FOR SELECT TO authenticated
    USING (public.is_group_member(group_id));

REVOKE ALL ON TABLE public.import_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.import_batches TO service_role;

-- What belongs to a batch. SET NULL, not CASCADE: a batch row is bookkeeping,
-- and nothing about forgetting it should be able to take a ledger row with it.
ALTER TABLE public.expense_versions ADD COLUMN import_batch_id uuid;
ALTER TABLE public.settlements ADD COLUMN import_batch_id uuid;
ALTER TABLE public.group_members ADD COLUMN import_batch_id uuid;

ALTER TABLE ONLY public.expense_versions
    ADD CONSTRAINT expense_versions_import_batch_id_fkey FOREIGN KEY (import_batch_id)
    REFERENCES public.import_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.settlements
    ADD CONSTRAINT settlements_import_batch_id_fkey FOREIGN KEY (import_batch_id)
    REFERENCES public.import_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_import_batch_id_fkey FOREIGN KEY (import_batch_id)
    REFERENCES public.import_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX expense_versions_import_batch_id_idx ON public.expense_versions USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);
CREATE INDEX settlements_import_batch_id_idx ON public.settlements USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);
CREATE INDEX group_members_import_batch_id_idx ON public.group_members USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);

-- One "imported" activity row per batch, however many chunks wrote it. The
-- index is what lets the RPC upsert the row instead of adding one per chunk.
CREATE UNIQUE INDEX activity_log_import_batch_uniq ON public.activity_log USING btree (object_id)
    WHERE (object_type = 'import_batch' AND verb = 'imported');

-- ─────────────────────────────────────────────── three narrow exemptions ──
--
-- Undo and the one-row-per-batch activity entry each need to do something an
-- invariant forbids. Each exemption below is limited three ways: a transaction-
-- local setting that only the definer function sets, naming the exact batch;
-- a row that belongs to that batch; and, for the two guards that a signed-in
-- client could otherwise reach by setting the same setting itself, a check
-- that the caller is not a client role. Everything else behaves as before.

-- (1) activity_log is append-only (ADR-004). The "imported" row of a batch is
-- the single exception: its counts grow as chunks land. It is also re-stamped
-- on UPDATE so the new counts reach phones that already pulled the row.
CREATE OR REPLACE FUNCTION public.waves_activity_log_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_user NOT IN ('anon', 'authenticated')
     AND OLD.object_type = 'import_batch'
     AND OLD.verb = 'imported'
     AND NEW.object_type = OLD.object_type
     AND NEW.verb = OLD.verb
     AND NEW.object_id IS NOT DISTINCT FROM OLD.object_id
     AND NEW.group_id = OLD.group_id
     AND current_setting('waves.import_activity', true) = OLD.object_id::text THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'APPEND_ONLY: % rows cannot be % (ADR-004). Insert a new version or set deleted_at.',
    TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'restrict_violation';
END
$$;

REVOKE ALL ON FUNCTION public.waves_activity_log_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_activity_log_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_activity_log_guard() TO service_role;

DROP TRIGGER activity_log_append_only ON public.activity_log;
CREATE TRIGGER activity_log_append_only BEFORE DELETE OR UPDATE ON public.activity_log
    FOR EACH ROW EXECUTE FUNCTION public.waves_activity_log_guard();

DROP TRIGGER activity_log_stamp_seq ON public.activity_log;
CREATE TRIGGER activity_log_stamp_seq BEFORE INSERT OR UPDATE ON public.activity_log
    FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();

-- (2) A settlement never goes from confirmed back to cancelled (ADR-007): a
-- debt somebody agreed was paid is unwound by a new expense. Undoing an import
-- is the one case where the "payment" was a line in a file, not an agreement,
-- so the batch's own settlements may be cancelled. Same function as the
-- baseline with one extra branch.
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

-- (3) The settlement notice: see the branch added below.

-- (4) One balance refresh per group per burst of writes, not one per row.
--
-- `waves_touch_balances` is a DEFERRED constraint trigger, so it runs at COMMIT
-- once for every row event: each expense is ~7 events (the expense, its payers,
-- its shares), and each event rebuilt the group's entire balances AND pairwise
-- tables from the whole ledger. A 250-row import therefore did ~1,750 full
-- rebuilds in one statement - measured at over a hundred milliseconds PER ROW
-- before this change, growing with the size of the group, far past the API's
-- 8 s statement timeout.
--
-- A refresh reads the whole group, so a refresh that follows the last write is
-- as good as any later one. But deferred events can fire EARLY (SET CONSTRAINTS
-- ... IMMEDIATE, which migrations here have used), with more writes after. So
-- "already refreshed in this transaction" is not enough; it must be "already
-- refreshed since the last write". An immediate row trigger on the same tables
-- bumps a transaction-local per-group generation on every write; the deferred
-- refresh records the generation it ran at and skips only while that is still
-- the current one. At commit the first event refreshes, the rest skip; a write
-- after an early refresh bumps the generation and forces another.
CREATE FUNCTION public.waves_mark_balances_dirty() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id uuid;
  v_key      text;
BEGIN
  IF TG_TABLE_NAME IN ('expenses', 'settlements') THEN
    IF TG_OP = 'DELETE' THEN
      v_group_id := OLD.group_id;
    ELSE
      v_group_id := NEW.group_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_group_id := public.waves_version_group_id(OLD.expense_version_id);
    ELSE
      v_group_id := public.waves_version_group_id(NEW.expense_version_id);
    END IF;
  END IF;

  IF v_group_id IS NOT NULL THEN
    v_key := 'waves.bal_gen_' || replace(v_group_id::text, '-', '');
    PERFORM set_config(
      v_key, (COALESCE(NULLIF(current_setting(v_key, true), ''), '0')::bigint + 1)::text, true
    );
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_mark_balances_dirty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_mark_balances_dirty() TO service_role;

CREATE TRIGGER expenses_mark_dirty AFTER INSERT OR UPDATE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.waves_mark_balances_dirty();
CREATE TRIGGER settlements_mark_dirty AFTER INSERT OR UPDATE ON public.settlements
    FOR EACH ROW EXECUTE FUNCTION public.waves_mark_balances_dirty();
CREATE TRIGGER expense_payers_mark_dirty AFTER INSERT OR DELETE ON public.expense_payers
    FOR EACH ROW EXECUTE FUNCTION public.waves_mark_balances_dirty();
CREATE TRIGGER expense_shares_mark_dirty AFTER INSERT OR DELETE ON public.expense_shares
    FOR EACH ROW EXECUTE FUNCTION public.waves_mark_balances_dirty();

CREATE OR REPLACE FUNCTION public.waves_touch_balances() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id uuid;
  v_suffix   text;
  v_gen      text;
BEGIN
  IF TG_TABLE_NAME IN ('expenses', 'settlements') THEN
    IF TG_OP = 'DELETE' THEN
      v_group_id := OLD.group_id;
    ELSE
      v_group_id := NEW.group_id;
    END IF;
  ELSIF TG_TABLE_NAME IN ('expense_payers', 'expense_shares') THEN
    IF TG_OP = 'DELETE' THEN
      v_group_id := public.waves_version_group_id(OLD.expense_version_id);
    ELSE
      v_group_id := public.waves_version_group_id(NEW.expense_version_id);
    END IF;
  END IF;

  IF v_group_id IS NOT NULL THEN
    v_suffix := replace(v_group_id::text, '-', '');
    v_gen := COALESCE(NULLIF(current_setting('waves.bal_gen_' || v_suffix, true), ''), '0');
    IF COALESCE(current_setting('waves.bal_done_' || v_suffix, true), '') IS DISTINCT FROM v_gen THEN
      PERFORM public.waves_refresh_group_balances(v_group_id);
      PERFORM set_config('waves.bal_done_' || v_suffix, v_gen, true);
    END IF;
  END IF;
  RETURN NULL;
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

-- ──────────────────────────────────────────── waves_apply_expense, batched ──
--
-- `waves_apply_expense` gains `p_import_batch_id` as its LAST parameter,
-- defaulted to NULL, so every existing caller (the `expense-write` and `sync`
-- edges, the agent tools, the seeds) keeps resolving by name. NULL is every
-- write that is not part of an import. The signature changes, so the old one is
-- dropped explicitly: a bare CREATE OR REPLACE would leave two overloads and
-- make old callers hit "not unique". Everything else is the previous definition
-- (20261009200000) unchanged, apart from the batch's group check.

DROP FUNCTION IF EXISTS public.waves_apply_expense(
  uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid,
  text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date,
  timestamptz, text
);

CREATE FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text DEFAULT NULL::text, p_receipt_id uuid DEFAULT NULL::uuid, p_base_version_no integer DEFAULT NULL::integer, p_fx jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'manual'::text, p_payment_method text DEFAULT NULL::text, p_receipt_share_url text DEFAULT NULL::text, p_category_meta jsonb DEFAULT NULL::jsonb, p_location jsonb DEFAULT NULL::jsonb, p_sub_event_id text DEFAULT NULL::text, p_is_deposit boolean DEFAULT false, p_balance_due_minor bigint DEFAULT NULL::bigint, p_balance_due_date date DEFAULT NULL::date, p_occurred_at timestamptz DEFAULT NULL::timestamptz, p_payee text DEFAULT NULL::text, p_import_batch_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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

  -- A row filed under an import batch must name a batch of THIS group. The
  -- column is a plain FK, which would accept another group's batch id.
  IF p_import_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.import_batches b
     WHERE b.id = p_import_batch_id AND b.group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_BATCH: that import batch is not in this group'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

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
     sub_event_id, is_deposit, balance_due_minor, balance_due_date, occurred_at, payee, import_batch_id)
  VALUES
    (p_expense_id, v_version_no, p_author_member_id, p_description, p_category, p_category_meta, p_expense_date,
     upper(p_currency), p_amount, p_split_type::"SplitType", p_split_params, p_receipt_id,
     p_notes, p_payment_method, p_receipt_share_url, p_location, p_client_mutation_id, p_fx,
     COALESCE(p_source, 'manual')::"ExpenseSource",
     p_sub_event_id, COALESCE(p_is_deposit, false), p_balance_due_minor, p_balance_due_date, v_occurred_at, v_payee, p_import_batch_id)
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


REVOKE ALL ON FUNCTION public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz, text, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz, text, uuid) TO service_role;

-- ───────────────────────────────────────── the new kind of notification ──
--
-- `group_import`: one digest per import, under the "involves me" switch like
-- the expense notices. Otherwise unchanged from 20260908120000.

CREATE OR REPLACE FUNCTION public.waves_pref_key_for_kind(p_kind text) RETURNS text
    LANGUAGE sql IMMUTABLE
    -- Pinned like everything else in this schema, and checked by
    -- `anon-surface.test.ts`. A pure CASE over a text literal reads nothing, so
    -- there is no path for a path to matter on — which is exactly the argument
    -- somebody makes right before the one function without a pin is the one
    -- that grows a table lookup.
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


REVOKE ALL ON FUNCTION public.waves_pref_key_for_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_pref_key_for_kind(text) TO service_role;

-- ───────────────────────────────────────── the rows, shared by both RPCs ──
--
-- The body of `waves_import_ledger`, lifted out unchanged except for:
--   * `p_batch_id`. When it is set, a person with no member id is looked up
--     among the ghosts THIS batch already minted before a new one is made. A
--     replayed chunk, and every chunk after the first, therefore lands on the
--     same ghosts instead of minting a second "Ravi". (Before this, a replayed
--     `waves_import_ledger` call minted its ghosts again every time.) Rows,
--     ghosts and settlements it writes carry the batch id;
--   * `splitHint`. An expense may say `"splitHint": "equal"`; when its shares
--     are within one minor unit of each other it is stored as an equal split,
--     so it opens in the editor as one. Anything else stays exact: the
--     participants are new members with new ids, so a percentage or a set of
--     weights would have to be re-divided server-side and could land a paisa
--     somewhere the file did not.
--
-- It does NOT check who is calling: both callers have already proved the caller
-- is a live member and pass the member they are acting as. Neither client role
-- can reach it.

CREATE FUNCTION public.waves_import_rows(p_group_id uuid, p_author uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_batch_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
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
  v_split_type  text;
  v_split_params jsonb;
  v_share_min   bigint;
  v_share_max   bigint;
  v_share_count int;
BEGIN
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

    v_member := NULL;
    IF (v_person ->> 'memberId') IS NOT NULL THEN
      SELECT gm.id INTO v_member
        FROM public.group_members gm
       WHERE gm.id = (v_person ->> 'memberId')::uuid AND gm.group_id = p_group_id;
      IF v_member IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_MEMBER: % is not in this group', v_name
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    ELSE
      -- A ghost this batch already minted is the same person on a replay and
      -- in every later chunk.
      IF p_batch_id IS NOT NULL THEN
        SELECT gm.id INTO v_member
          FROM public.group_members gm
         WHERE gm.group_id = p_group_id
           AND gm.import_batch_id = p_batch_id
           AND gm.profile_id IS NULL
           AND gm.ghost_name = v_name
         ORDER BY gm.created_at, gm.id
         LIMIT 1;
      END IF;

      IF v_member IS NULL THEN
        INSERT INTO public.group_members (group_id, ghost_name, joined_via, import_batch_id)
        VALUES (p_group_id, v_name, 'ghost', p_batch_id)
        RETURNING id INTO v_member;
        v_ghosts := v_ghosts + 1;
      END IF;
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

    -- 'exact' regardless of how the split was originally expressed, with one
    -- exception: an expense the file says was split equally, whose shares are
    -- in fact within a minor unit of each other, is stored as an equal split.
    -- With an exact split the shares ARE the split params, so there is nothing
    -- for the server to recompute; `waves_check_expense_totals` still refuses
    -- a version whose payers or shares do not sum to the amount.
    v_split_type := 'exact';
    v_split_params := jsonb_build_object('kind', 'exact', 'amounts', (
      SELECT COALESCE(jsonb_object_agg(v_names ->> entry.key, entry.value), '{}'::jsonb)
        FROM jsonb_each(v_expense -> 'shares') AS entry
    ));

    IF lower(COALESCE(v_expense ->> 'splitHint', '')) = 'equal' THEN
      SELECT min((entry.value #>> '{}')::bigint), max((entry.value #>> '{}')::bigint), count(*)
        INTO v_share_min, v_share_max, v_share_count
        FROM jsonb_each(v_expense -> 'shares') AS entry;
      IF v_share_count >= 2 AND v_share_max - v_share_min <= 1 THEN
        v_split_type := 'equal';
        v_split_params := jsonb_build_object('kind', 'equal');
      END IF;
    END IF;

    v_result := public.waves_apply_expense(
      p_group_id           => p_group_id,
      p_expense_id         => NULL,
      p_author_member_id   => p_author,
      p_description        => COALESCE(v_expense ->> 'description', 'Imported expense'),
      p_category           => v_expense ->> 'category',
      p_expense_date       => (v_expense ->> 'date')::date,
      p_currency           => upper(COALESCE(v_expense ->> 'currency', 'INR'))::char(3),
      p_amount             => (v_expense ->> 'amount')::bigint,
      p_split_type         => v_split_type,
      p_split_params       => v_split_params,
      p_payers             => v_payers,
      p_shares             => v_shares,
      p_client_mutation_id => (v_expense ->> 'clientMutationId')::uuid,
      p_source             => 'imported',
      -- "Paid to", when the file has one. Absent (a Splitwise CSV has no such
      -- column) is NULL, which on a new expense is simply none.
      p_payee              => v_expense ->> 'payee',
      p_import_batch_id    => p_batch_id
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
      IF v_to = p_author OR (NOT v_to_real AND (v_from = p_author OR NOT v_from_real)) THEN
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

    -- NB: for a confirmed row `confirmed_at = initiated_at` by construction.
    -- `waves_undo_import` reads that to tell "still as imported" from "since
    -- confirmed by somebody", whose confirmed_at is the later moment.
    INSERT INTO public.settlements
      (group_id, from_member_id, to_member_id, currency, amount, method, status, note,
       initiated_at, confirmed_at, client_mutation_id, import_batch_id)
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
      v_mutation,
      p_batch_id
    );

    IF v_status = 'initiated' THEN
      v_pending := v_pending + 1;
    END IF;
    v_settled := v_settled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'expenses', v_created,
    'ghosts', v_ghosts,
    'settlements', v_settled,
    'settlementsPending', v_pending,
    'members', v_names
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_import_rows(p_group_id uuid, p_author uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_batch_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_import_rows(p_group_id uuid, p_author uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_batch_id uuid) TO service_role;

-- ───────────────────────────────────────────── the new-group import, as was ──
--
-- Same signature, same result, same one `imported` entry on the group. Only the
-- middle moved into `waves_import_rows`.

CREATE OR REPLACE FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb DEFAULT '[]'::jsonb, p_origin text DEFAULT 'splitwise'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id  uuid := public.waves_current_profile_id();
  v_author      uuid;
  v_result      jsonb;
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_author := public.waves_my_member_id_for(p_group_id, v_profile_id);

  v_result := public.waves_import_rows(p_group_id, v_author, p_people, p_expenses, p_settlements, NULL);

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    p_group_id, v_author, 'imported', 'group', p_group_id,
    jsonb_build_object(
      'expenses', v_result -> 'expenses', 'ghosts', v_result -> 'ghosts',
      'settlements', v_result -> 'settlements',
      'settlementsPending', v_result -> 'settlementsPending', 'from', p_origin
    )
  );

  RETURN jsonb_build_object('groupId', p_group_id) || v_result;
END
$$;

REVOKE ALL ON FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_origin text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_origin text) TO authenticated;
GRANT ALL ON FUNCTION public.waves_import_ledger(p_group_id uuid, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_origin text) TO service_role;

-- ─────────────────────────────────────────── import into an existing group ──
--
-- One CHUNK of an import. The phone sends up to 250 rows per call under one
-- `p_batch_id` it chose up front, with a fixed `clientMutationId` on every row,
-- so a retry of any chunk is a replay: no row, ghost or settlement twice.
--
--   * Each chunk is atomic; the import as a whole is not. A dropped connection
--     leaves a partial batch, which the phone resumes and which Undo handles.
--   * 500 rows is the most a single call accepts (TOO_MANY_ROWS). Row count is
--     the unit because the cost is the per-row balance triggers, not the bytes.
--   * ONE `imported` activity entry per batch, kept current as chunks land.
--   * `p_final` marks the last chunk. Only then do the other members get ONE
--     digest notification ("Madan imported 42 expenses into Goa trip"). It is
--     the existing `involvesMe` switch and a muted group is not pushed
--     (`waves_claim_push_notifications` reads both). Per-expense notifications
--     stay off: `source = 'imported'`. Defaults to true so a caller that sends
--     everything in one call needs no extra argument.

CREATE FUNCTION public.waves_import_into_group(p_group_id uuid, p_batch_id uuid, p_source text, p_people jsonb, p_expenses jsonb, p_settlements jsonb DEFAULT '[]'::jsonb, p_final boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_max_rows    constant int := 500;
  v_profile_id  uuid := public.waves_current_profile_id();
  v_author      uuid;
  v_batch       public.import_batches;
  v_result      jsonb;
  v_recipient   record;
  v_actor_name  text;
  v_group_name  text;
BEGIN
  IF v_profile_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'NO_BATCH: an import needs a batch id' USING ERRCODE = 'check_violation';
  END IF;

  IF p_source IS NULL OR p_source NOT IN ('csv', 'splitwise', 'waves_csv', 'waves_json', 'xlsx', 'screenshot') THEN
    RAISE EXCEPTION 'INVALID_SOURCE: "%" is not a kind of import', COALESCE(p_source, '')
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_typeof(p_expenses) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_settlements, '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'NO_ROWS: expenses and settlements must be lists' USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_array_length(p_expenses) + jsonb_array_length(COALESCE(p_settlements, '[]'::jsonb)) > v_max_rows THEN
    RAISE EXCEPTION 'TOO_MANY_ROWS: send at most % rows per call', v_max_rows
      USING ERRCODE = 'check_violation';
  END IF;

  v_author := public.waves_my_member_id_for(p_group_id, v_profile_id);

  -- The batch is claimed by the first chunk. A replay of it finds its own row.
  INSERT INTO public.import_batches (id, group_id, actor_member_id, source)
  VALUES (p_batch_id, p_group_id, v_author, p_source)
  ON CONFLICT (id) DO NOTHING;

  -- Locked for the rest of the call: two chunks of one batch never interleave,
  -- and an undo cannot slip between this check and the rows it would remove.
  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;

  -- A batch id is a capability to write under it. It only ever belongs to the
  -- group and the person that first used it.
  IF v_batch.group_id <> p_group_id
     OR v_batch.actor_member_id IS DISTINCT FROM v_author THEN
    RAISE EXCEPTION 'BATCH_CONFLICT: that import belongs to somebody else'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_batch.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'IMPORT_UNDONE: that import was undone; start a new one'
      USING ERRCODE = 'check_violation';
  END IF;

  v_result := public.waves_import_rows(
    p_group_id, v_author, p_people, p_expenses, COALESCE(p_settlements, '[]'::jsonb), p_batch_id
  );

  UPDATE public.import_batches
     SET expense_count    = expense_count    + (v_result ->> 'expenses')::int,
         settlement_count = settlement_count + (v_result ->> 'settlements')::int,
         ghost_count      = ghost_count      + (v_result ->> 'ghosts')::int
   WHERE id = p_batch_id
   RETURNING * INTO v_batch;

  -- The single "imported" entry for the batch, kept at the running totals.
  PERFORM set_config('waves.import_activity', p_batch_id::text, true);
  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    p_group_id, v_author, 'imported', 'import_batch', p_batch_id,
    jsonb_build_object(
      'expenses', v_batch.expense_count, 'settlements', v_batch.settlement_count,
      'ghosts', v_batch.ghost_count, 'from', v_batch.source
    )
  )
  ON CONFLICT (object_id) WHERE (object_type = 'import_batch' AND verb = 'imported')
  DO UPDATE SET payload = EXCLUDED.payload;
  PERFORM set_config('waves.import_activity', '', true);

  -- ── one quiet digest for everybody else on Waves ───────────────────────
  --
  -- Last chunk only, so the number in it is the whole import. The dedupe key is
  -- the batch and the recipient: a retried final chunk cannot tell anybody twice.
  IF p_final AND (v_batch.expense_count + v_batch.settlement_count) > 0 THEN
    SELECT COALESCE(p.display_name, m.ghost_name) INTO v_actor_name
      FROM public.group_members m
      LEFT JOIN public.profiles p ON p.id = m.profile_id
     WHERE m.id = v_author;
    SELECT g.name INTO v_group_name FROM public.groups g WHERE g.id = p_group_id;

    FOR v_recipient IN
      SELECT DISTINCT m.profile_id
        FROM public.group_members m
       WHERE m.group_id = p_group_id
         AND m.profile_id IS NOT NULL
         AND m.left_at IS NULL
         AND m.profile_id IS DISTINCT FROM v_profile_id
    LOOP
      PERFORM public.waves_notify(
        v_recipient.profile_id,
        p_group_id,
        'group_import',
        COALESCE(v_actor_name, 'Someone') || ' imported expenses',
        v_batch.expense_count::text || ' added to ' || COALESCE(v_group_name, 'your group'),
        'waves://group/' || p_group_id::text,
        jsonb_build_object(
          'counterparty', v_actor_name,
          'group', v_group_name,
          'count', v_batch.expense_count::text,
          'batchId', p_batch_id
        ),
        'group_import:' || p_batch_id::text || ':' || v_recipient.profile_id::text
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'groupId', p_group_id,
    'batchId', p_batch_id,
    'expenses', v_result -> 'expenses',
    'ghosts', v_result -> 'ghosts',
    'settlements', v_result -> 'settlements',
    'settlementsPending', v_result -> 'settlementsPending',
    'members', v_result -> 'members',
    'totals', jsonb_build_object(
      'expenses', v_batch.expense_count,
      'settlements', v_batch.settlement_count,
      'ghosts', v_batch.ghost_count
    )
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_import_into_group(p_group_id uuid, p_batch_id uuid, p_source text, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_final boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_import_into_group(p_group_id uuid, p_batch_id uuid, p_source text, p_people jsonb, p_expenses jsonb, p_settlements jsonb, p_final boolean) TO authenticated;

-- ──────────────────────────────────────────────────────── undo an import ──
--
-- Who:    the person who ran the import, or an admin of the group.
-- When:   within 24 hours of the batch being created (`IMPORT_UNDO_WINDOW_HOURS`
--         in @waves/core; the two are kept equal by a test).
-- Unless: somebody has edited an imported expense (a second version exists) or
--         moved an imported settlement on (confirmed, disputed, auto-confirmed
--         since). Then `IMPORT_EDITED`: undoing would throw away their work, so
--         it is theirs to unpick by hand.
--
-- Effect: the batch's expenses are soft-deleted exactly as `waves_delete_expense`
-- does it (so the balance triggers fire and they sit in the group's Deleted
-- list for 30 days); its settlements are cancelled; ghosts it minted that
-- nothing else refers to are taken out of the group (`left_at`, the soft form
-- of removal: payers and shares rows are append-only and keep pointing at
-- them). One `import_undone` entry. Replaying an undo is a no-op.

CREATE FUNCTION public.waves_undo_import(p_batch_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_window      constant interval := interval '24 hours';
  v_profile_id  uuid := public.waves_current_profile_id();
  v_batch       public.import_batches;
  v_me          uuid;
  v_expenses    int;
  v_settlements int;
  v_kept        int;
  v_removed     int;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: sign in to undo an import'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no such import' USING ERRCODE = 'no_data_found';
  END IF;

  v_me := public.waves_my_member_id_for(v_batch.group_id, v_profile_id);
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The importer is matched by PERSON, not by member row, so a ghost claimed
  -- since (a new member row) does not lock them out of their own import.
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.group_members a
       WHERE a.id = v_batch.actor_member_id AND a.profile_id = v_profile_id
    )
    OR public.is_group_admin(v_batch.group_id)
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only the person who imported this, or an admin, can undo it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Replay: already undone, nothing left to do.
  IF v_batch.undone_at IS NOT NULL THEN
    RETURN jsonb_build_object('batchId', p_batch_id, 'undone', true, 'replayed', true);
  END IF;

  IF now() > v_batch.created_at + v_window THEN
    RAISE EXCEPTION 'IMPORT_UNDO_EXPIRED: an import can only be undone within 24 hours'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public.expense_versions first_v
         JOIN public.expense_versions later ON later.expense_id = first_v.expense_id
        WHERE first_v.import_batch_id = p_batch_id
          AND later.version_no > first_v.version_no
     )
     OR EXISTS (
       SELECT 1
         FROM public.settlements s
        WHERE s.import_batch_id = p_batch_id
          AND NOT (
            s.status = 'initiated'
            -- Still as imported: a confirmed row was written with
            -- confirmed_at = initiated_at; one confirmed later was not.
            OR (s.status = 'confirmed' AND s.confirmed_at = s.initiated_at)
            OR s.status = 'cancelled'
          )
     ) THEN
    RAISE EXCEPTION 'IMPORT_EDITED: something from this import has been changed since, so it cannot be undone in one go'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Expenses: the same UPDATE as waves_delete_expense.
  UPDATE public.expenses e
     SET deleted_at = now(), deleted_by = v_me
   WHERE e.deleted_at IS NULL
     AND e.group_id = v_batch.group_id
     AND e.id IN (
       SELECT ev.expense_id FROM public.expense_versions ev WHERE ev.import_batch_id = p_batch_id
     );
  GET DIAGNOSTICS v_expenses = ROW_COUNT;

  -- Settlements: cancelled, quietly (see the guards above).
  PERFORM set_config('waves.undoing_import', p_batch_id::text, true);
  UPDATE public.settlements s
     SET status = 'cancelled'
   WHERE s.import_batch_id = p_batch_id AND s.status <> 'cancelled';
  GET DIAGNOSTICS v_settlements = ROW_COUNT;
  PERFORM set_config('waves.undoing_import', '', true);

  -- Ghosts this batch minted, that nothing outside the batch refers to.
  WITH minted AS (
    SELECT gm.id
      FROM public.group_members gm
     WHERE gm.import_batch_id = p_batch_id
       AND gm.profile_id IS NULL
       AND gm.left_at IS NULL
       AND gm.invite_email IS NULL
       AND gm.invite_phone IS NULL
  ), kept AS (
    SELECT m.id FROM minted m
     WHERE EXISTS (
             -- on a live expense, or any version of an expense that is not this batch's
             SELECT 1
               FROM public.expense_versions ev
               JOIN public.expenses e ON e.id = ev.expense_id
              WHERE ev.import_batch_id IS DISTINCT FROM p_batch_id
                AND (EXISTS (SELECT 1 FROM public.expense_payers p WHERE p.expense_version_id = ev.id AND p.member_id = m.id)
                  OR EXISTS (SELECT 1 FROM public.expense_shares sh WHERE sh.expense_version_id = ev.id AND sh.member_id = m.id))
           )
        OR EXISTS (
             SELECT 1 FROM public.settlements s
              WHERE (s.from_member_id = m.id OR s.to_member_id = m.id)
                AND s.import_batch_id IS DISTINCT FROM p_batch_id
           )
        OR EXISTS (SELECT 1 FROM public.member_claims c WHERE c.member_id = m.id)
        OR EXISTS (SELECT 1 FROM public.expense_comments c WHERE c.author_member_id = m.id)
  ), gone AS (
    UPDATE public.group_members gm
       SET left_at = now()
      FROM minted m
     WHERE gm.id = m.id AND m.id NOT IN (SELECT id FROM kept)
    RETURNING gm.id
  )
  SELECT (SELECT count(*) FROM gone), (SELECT count(*) FROM kept) INTO v_removed, v_kept;

  UPDATE public.import_batches
     SET undone_at = now(), undone_by = v_me
   WHERE id = p_batch_id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (
    v_batch.group_id, v_me, 'import_undone', 'import_batch', p_batch_id,
    jsonb_build_object(
      'expenses', v_expenses, 'settlements', v_settlements,
      'ghostsRemoved', v_removed, 'ghostsKept', v_kept, 'from', v_batch.source
    )
  );

  RETURN jsonb_build_object(
    'batchId', p_batch_id,
    'undone', true,
    'replayed', false,
    'expenses', v_expenses,
    'settlements', v_settlements,
    'ghostsRemoved', v_removed,
    'ghostsKept', v_kept
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_undo_import(p_batch_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_undo_import(p_batch_id uuid) TO authenticated;
