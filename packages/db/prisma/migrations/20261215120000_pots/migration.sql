-- Pots use the ordinary expense and socially confirmed settlement ledger.
-- No UPI callback changes status. No rows move on carry-forward.
CREATE TYPE public."PotStatus" AS ENUM ('open', 'closed', 'carried');
CREATE TYPE public."SettlementReferenceSource" AS ENUM ('self', 'sms', 'statement', 'intent');
CREATE TABLE public.pots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  per_head_minor bigint NOT NULL CHECK (per_head_minor > 0),
  treasurer_member_id uuid NOT NULL REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  status public."PotStatus" NOT NULL DEFAULT 'open',
  carried_from_pot_id uuid UNIQUE REFERENCES public.pots(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  closed_at timestamptz(6),
  pay_code text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  client_mutation_id uuid UNIQUE,
  close_client_mutation_id uuid UNIQUE,
  CHECK (length(pay_code) >= 10),
  CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE INDEX pots_group_id_idx ON public.pots(group_id);
ALTER TABLE public.settlements
  ADD COLUMN pot_id uuid REFERENCES public.pots(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN reference text,
  ADD COLUMN reference_source public."SettlementReferenceSource";
ALTER TABLE public.expense_versions ADD COLUMN pot_id uuid REFERENCES public.pots(id) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX settlements_pot_id_idx ON public.settlements(pot_id);
CREATE INDEX expense_versions_pot_id_idx ON public.expense_versions(pot_id);

CREATE FUNCTION public.waves_can_manage_pot(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM pots p WHERE p.id = p_id AND
    (is_group_admin(p.group_id) OR EXISTS (SELECT 1 FROM group_members m
      WHERE m.id = p.treasurer_member_id AND m.left_at IS NULL
        AND m.profile_id = waves_current_profile_id())));
$$;
REVOKE ALL ON FUNCTION public.waves_can_manage_pot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_can_manage_pot(uuid) TO authenticated, service_role;
ALTER TABLE public.pots ENABLE ROW LEVEL SECURITY;
CREATE POLICY pots_read ON public.pots FOR SELECT TO authenticated USING (is_group_member(group_id));
CREATE POLICY pots_insert ON public.pots FOR INSERT TO authenticated WITH CHECK (
  is_group_admin(group_id) OR EXISTS (SELECT 1 FROM group_members m
    WHERE m.id = treasurer_member_id AND m.profile_id = waves_current_profile_id() AND m.left_at IS NULL));
CREATE POLICY pots_update ON public.pots FOR UPDATE TO authenticated
  USING (waves_can_manage_pot(id)) WITH CHECK (waves_can_manage_pot(id));
GRANT SELECT, INSERT, UPDATE ON public.pots TO authenticated;
GRANT ALL ON public.pots TO service_role;
REVOKE ALL ON public.pots FROM anon;

CREATE FUNCTION public.waves_guard_pot() RETURNS trigger
LANGUAGE plpgsql SET search_path TO public, pg_temp AS $$
BEGIN
  -- A caller cannot choose a guessable public capability, even on direct INSERT.
  IF TG_OP = 'INSERT' THEN NEW.pay_code := replace(gen_random_uuid()::text, '-', ''); END IF;
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE id = NEW.treasurer_member_id
    AND group_id = NEW.group_id AND left_at IS NULL) OR NOT EXISTS (
    SELECT 1 FROM group_members WHERE id = NEW.created_by AND group_id = NEW.group_id
      AND (TG_OP <> 'INSERT' OR left_at IS NULL)) THEN
    RAISE EXCEPTION 'POT_WRONG_GROUP';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.carried_from_pot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pots WHERE id = NEW.carried_from_pot_id AND group_id = NEW.group_id
      AND currency = NEW.currency AND treasurer_member_id = NEW.treasurer_member_id
      AND status = 'carried') THEN RAISE EXCEPTION 'POT_INVALID_CARRY'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.group_id, NEW.currency, NEW.treasurer_member_id, NEW.created_by,
    NEW.carried_from_pot_id, NEW.pay_code, NEW.client_mutation_id, NEW.per_head_minor)
    IS DISTINCT FROM (OLD.group_id, OLD.currency, OLD.treasurer_member_id, OLD.created_by,
    OLD.carried_from_pot_id, OLD.pay_code, OLD.client_mutation_id, OLD.per_head_minor) THEN
    RAISE EXCEPTION 'POT_IMMUTABLE';
  END IF;
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status <> 'open' OR NEW.carried_from_pot_id IS NOT NULL OR
         NOT EXISTS (SELECT 1 FROM group_members WHERE id = NEW.created_by
           AND profile_id = waves_current_profile_id() AND left_at IS NULL) THEN
        RAISE EXCEPTION 'POT_USE_RPC';
      END IF;
    ELSIF (NEW.status, NEW.closed_at, NEW.close_client_mutation_id) IS DISTINCT FROM
          (OLD.status, OLD.closed_at, OLD.close_client_mutation_id) THEN
      RAISE EXCEPTION 'POT_USE_RPC';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pots_guard BEFORE INSERT OR UPDATE ON public.pots FOR EACH ROW EXECUTE FUNCTION public.waves_guard_pot();

-- Lock the same pot as close/carry before accepting financial changes. This
-- serializes an in-flight contribution or expense against the close snapshot.
CREATE FUNCTION public.waves_guard_pot_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE p pots; v_group uuid; v_version uuid; v_pot uuid;
BEGIN
  IF TG_TABLE_NAME = 'expense_payers' THEN
    v_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.expense_version_id ELSE NEW.expense_version_id END;
    SELECT pot_id INTO v_pot FROM expense_versions WHERE id = v_version;
  ELSE
    v_pot := NEW.pot_id;
  END IF;
  IF TG_TABLE_NAME = 'settlements' THEN
    IF TG_OP = 'UPDATE' AND OLD.pot_id IS NOT NULL AND NEW.pot_id IS DISTINCT FROM OLD.pot_id THEN
      RAISE EXCEPTION 'POT_IMMUTABLE_SETTLEMENT';
    END IF;
  END IF;
  IF v_pot IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT p FROM pots WHERE id = v_pot FOR UPDATE;
  IF TG_TABLE_NAME = 'settlements' THEN
    IF TG_OP = 'UPDATE' AND OLD.pot_id IS NOT NULL AND (NEW.pot_id, NEW.group_id, NEW.from_member_id, NEW.to_member_id,
       NEW.amount, NEW.currency) IS DISTINCT FROM (OLD.pot_id, OLD.group_id, OLD.from_member_id,
       OLD.to_member_id, OLD.amount, OLD.currency) THEN RAISE EXCEPTION 'POT_IMMUTABLE_SETTLEMENT'; END IF;
    IF NEW.group_id <> p.group_id OR NEW.currency <> p.currency OR
       (NEW.from_member_id <> p.treasurer_member_id AND NEW.to_member_id <> p.treasurer_member_id) OR
       EXISTS (SELECT 1 FROM group_members WHERE id IN (NEW.from_member_id, NEW.to_member_id)
         AND group_id <> p.group_id) THEN RAISE EXCEPTION 'POT_INVALID_SETTLEMENT'; END IF;
    IF (TG_OP = 'INSERT' OR OLD.pot_id IS NULL) AND p.status <> 'open' THEN RAISE EXCEPTION 'POT_NOT_OPEN'; END IF;
  ELSIF TG_TABLE_NAME = 'expense_versions' THEN
    SELECT group_id INTO v_group FROM expenses WHERE id = NEW.expense_id;
    IF p.status <> 'open' OR v_group <> p.group_id OR NEW.currency <> p.currency THEN
      RAISE EXCEPTION 'POT_INVALID_EXPENSE'; END IF;
  ELSE
    IF p.status <> 'open' OR TG_OP = 'DELETE' OR NEW.member_id <> p.treasurer_member_id THEN
      RAISE EXCEPTION 'POT_PAYER_MUST_BE_TREASURER'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_guard_pot_ledger() FROM PUBLIC;
CREATE TRIGGER pot_settlement_guard BEFORE INSERT OR UPDATE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.waves_guard_pot_ledger();
CREATE TRIGGER pot_expense_guard BEFORE INSERT ON public.expense_versions FOR EACH ROW EXECUTE FUNCTION public.waves_guard_pot_ledger();
CREATE TRIGGER pot_payer_guard BEFORE INSERT OR UPDATE OR DELETE ON public.expense_payers FOR EACH ROW EXECUTE FUNCTION public.waves_guard_pot_ledger();

CREATE FUNCTION public.waves_close_pot(p_pot_id uuid, p_client_mutation_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE p pots; r record;
BEGIN
  IF NOT waves_can_manage_pot(p_pot_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO STRICT p FROM pots WHERE id = p_pot_id FOR UPDATE;
  IF p_client_mutation_id IS NULL THEN RAISE EXCEPTION 'MUTATION_ID_REQUIRED'; END IF;
  IF p.status = 'closed' THEN RETURN p.id; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'POT_NOT_OPEN'; END IF;
  IF EXISTS (SELECT 1 FROM settlements WHERE pot_id = p.id AND status IN ('initiated', 'disputed')) THEN
    RAISE EXCEPTION 'POT_PENDING_PAYMENTS';
  END IF;
  FOR r IN
    WITH movements AS (
      SELECT from_member_id AS member_id, amount AS delta FROM settlements
        WHERE pot_id = p.id AND status IN ('confirmed', 'auto_confirmed')
      UNION ALL
      SELECT to_member_id, -amount FROM settlements
        WHERE pot_id = p.id AND status IN ('confirmed', 'auto_confirmed')
      UNION ALL
      SELECT es.member_id, -es.amount FROM expense_shares es
        JOIN expense_versions ev ON ev.id = es.expense_version_id
        JOIN expenses e ON e.current_version_id = ev.id
        WHERE ev.pot_id = p.id AND e.deleted_at IS NULL
    ) SELECT member_id, sum(delta)::bigint AS balance FROM movements
      WHERE member_id <> p.treasurer_member_id GROUP BY member_id HAVING sum(delta) <> 0
      ORDER BY member_id
  LOOP
    INSERT INTO settlements(group_id, pot_id, from_member_id, to_member_id, currency, amount, method, status, note)
      VALUES (p.group_id, p.id,
        CASE WHEN r.balance > 0 THEN p.treasurer_member_id ELSE r.member_id END,
        CASE WHEN r.balance > 0 THEN r.member_id ELSE p.treasurer_member_id END,
        p.currency, abs(r.balance), 'other', 'initiated', 'Pot close');
  END LOOP;
  UPDATE pots SET status = 'closed', closed_at = now(), close_client_mutation_id = p_client_mutation_id WHERE id = p.id;
  RETURN p.id;
END $$;
REVOKE ALL ON FUNCTION public.waves_close_pot(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_close_pot(uuid, uuid) TO authenticated, service_role;

CREATE FUNCTION public.waves_carry_pot(p_pot_id uuid, p_group_id uuid, p_name text, p_client_mutation_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE p pots; v_id uuid;
BEGIN
  IF NOT waves_can_manage_pot(p_pot_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO STRICT p FROM pots WHERE id = p_pot_id FOR UPDATE;
  IF p_group_id <> p.group_id OR p_group_id IS NULL THEN RAISE EXCEPTION 'POT_WRONG_GROUP'; END IF;
  IF p_client_mutation_id IS NULL THEN RAISE EXCEPTION 'MUTATION_ID_REQUIRED'; END IF;
  SELECT id INTO v_id FROM pots WHERE carried_from_pot_id = p.id;
  IF FOUND THEN RETURN v_id; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'POT_NOT_OPEN'; END IF;
  UPDATE pots SET status = 'carried', closed_at = now() WHERE id = p.id;
  INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, carried_from_pot_id, created_by, client_mutation_id)
    VALUES (p.group_id, p_name, p.currency, p.per_head_minor, p.treasurer_member_id, p.id,
      (SELECT id FROM group_members WHERE group_id = p.group_id AND profile_id = waves_current_profile_id() AND left_at IS NULL LIMIT 1),
      p_client_mutation_id) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.waves_carry_pot(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_carry_pot(uuid, uuid, text, uuid) TO authenticated, service_role;

-- Public access and IP rate limiting live in the pot-pay edge function.
CREATE FUNCTION public.pot_pay_lookup(code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object('potName', p.name, 'groupName', g.name,
    'perHeadMinor', p.per_head_minor::text, 'currency', p.currency,
    'payeeName', COALESCE(pr.display_name, m.ghost_name),
    'payeeVpa', COALESCE(CASE WHEN m.payment_rail = 'upi' THEN m.payment_handle END,
      m.vpa, CASE WHEN pr.payment_rail = 'upi' THEN pr.payment_handle END, pr.default_vpa))
    INTO result FROM pots p JOIN groups g ON g.id = p.group_id
    JOIN group_members m ON m.id = p.treasurer_member_id
    LEFT JOIN profiles pr ON pr.id = m.profile_id
    WHERE p.pay_code = code AND p.status = 'open' AND m.left_at IS NULL;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.pot_pay_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pot_pay_lookup(text) TO service_role;

CREATE FUNCTION public.pot_pay_self_report(code text, payer_name text, utr text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE p pots; ids uuid[]; ref text := NULLIF(upper(btrim(utr)), '');
BEGIN
  IF length(btrim(payer_name)) NOT BETWEEN 1 AND 100 OR
     (ref IS NOT NULL AND (ref !~ '^([0-9]{12}|[A-Z]{4}[A-Z0-9][0-9]{9,})$' OR length(ref) > 64))
     THEN RETURN false; END IF;
  SELECT * INTO p FROM pots WHERE pay_code = code AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- A public name is never identity proof. Match only an unambiguous existing
  -- member; do not expose the roster or create a group member from public input.
  SELECT array_agg(m.id) INTO ids FROM group_members m LEFT JOIN profiles pr ON pr.id = m.profile_id
    WHERE m.group_id = p.group_id AND m.left_at IS NULL AND m.id <> p.treasurer_member_id
      AND lower(btrim(COALESCE(pr.display_name, m.ghost_name))) = lower(btrim(payer_name));
  IF COALESCE(cardinality(ids), 0) <> 1 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM settlements WHERE pot_id = p.id AND
    (reference = ref OR (ref IS NULL AND reference IS NULL AND from_member_id = ids[1]
      AND reference_source = 'self' AND status = 'initiated'))) THEN RETURN true; END IF;
  INSERT INTO settlements(group_id, pot_id, from_member_id, to_member_id, currency, amount,
    method, rail, status, reference, reference_source)
    VALUES (p.group_id, p.id, ids[1], p.treasurer_member_id, p.currency, p.per_head_minor,
      'upi', 'upi', 'initiated', ref, 'self');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.pot_pay_self_report(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pot_pay_self_report(text, text, text) TO service_role;

-- Replace, rather than overload, the current expense RPC.
DROP FUNCTION public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz, text, uuid, boolean);
CREATE FUNCTION public.waves_apply_expense(p_group_id uuid, p_expense_id uuid, p_author_member_id uuid, p_description text, p_category text, p_expense_date date, p_currency character, p_amount bigint, p_split_type text, p_split_params jsonb, p_payers jsonb, p_shares jsonb, p_client_mutation_id uuid, p_notes text DEFAULT NULL::text, p_receipt_id uuid DEFAULT NULL::uuid, p_base_version_no integer DEFAULT NULL::integer, p_fx jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'manual'::text, p_payment_method text DEFAULT NULL::text, p_receipt_share_url text DEFAULT NULL::text, p_category_meta jsonb DEFAULT NULL::jsonb, p_location jsonb DEFAULT NULL::jsonb, p_sub_event_id text DEFAULT NULL::text, p_is_deposit boolean DEFAULT false, p_balance_due_minor bigint DEFAULT NULL::bigint, p_balance_due_date date DEFAULT NULL::date, p_occurred_at timestamptz DEFAULT NULL::timestamptz, p_payee text DEFAULT NULL::text, p_import_batch_id uuid DEFAULT NULL::uuid, p_reimbursable boolean DEFAULT NULL::boolean, p_pot_id uuid DEFAULT NULL::uuid) RETURNS jsonb
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
  v_reimbursable    boolean := p_reimbursable;
  v_pot_id uuid := p_pot_id;
  v_pot pots;
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

  -- Old clients editing a pot expense must preserve its accounting identity.
  SELECT COALESCE(v_pot_id, ev.pot_id) INTO v_pot_id FROM expenses e
    JOIN expense_versions ev ON ev.id = e.current_version_id WHERE e.id = p_expense_id;
  v_pot_id := COALESCE(v_pot_id, p_pot_id);
  IF EXISTS (SELECT 1 FROM expenses e JOIN expense_versions ev ON ev.id = e.current_version_id
    WHERE e.id = p_expense_id AND ev.pot_id IS DISTINCT FROM v_pot_id) THEN
    RAISE EXCEPTION 'POT_IMMUTABLE_EXPENSE';
  END IF;
  IF v_pot_id IS NOT NULL THEN
    SELECT * INTO STRICT v_pot FROM pots WHERE id = v_pot_id FOR UPDATE;
    IF v_pot.group_id <> p_group_id OR v_pot.currency <> upper(p_currency) OR v_pot.status <> 'open' THEN
      RAISE EXCEPTION 'POT_INVALID_EXPENSE';
    END IF;
    IF jsonb_array_length(p_payers) <> 1 OR
       (p_payers->0->>'memberId')::uuid IS DISTINCT FROM v_pot.treasurer_member_id OR
       (p_payers->0->>'amount')::bigint IS DISTINCT FROM p_amount THEN
      RAISE EXCEPTION 'POT_PAYER_MUST_BE_TREASURER';
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

    -- "Work expense (to claim)" follows the same rule: NULL is "not sent", so
    -- an older client editing the amount keeps the flag; true/false is a
    -- decision and replaces it.
    IF v_reimbursable IS NULL THEN
      SELECT ev.reimbursable INTO v_reimbursable
        FROM public.expense_versions ev
        JOIN public.expenses e ON e.id = ev.expense_id AND e.current_version_id = ev.id
       WHERE ev.expense_id = p_expense_id;
    END IF;
  END IF;

  -- A new expense, or a carry-forward that found nothing, is not reimbursable.
  v_reimbursable := COALESCE(v_reimbursable, false);

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
     sub_event_id, is_deposit, balance_due_minor, balance_due_date, occurred_at, payee, import_batch_id, reimbursable, pot_id)
  VALUES
    (p_expense_id, v_version_no, p_author_member_id, p_description, p_category, p_category_meta, p_expense_date,
     upper(p_currency), p_amount, p_split_type::"SplitType", p_split_params, p_receipt_id,
     p_notes, p_payment_method, p_receipt_share_url, p_location, p_client_mutation_id, p_fx,
     COALESCE(p_source, 'manual')::"ExpenseSource",
     p_sub_event_id, COALESCE(p_is_deposit, false), p_balance_due_minor, p_balance_due_date, v_occurred_at, v_payee, p_import_batch_id, v_reimbursable, v_pot_id)
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


REVOKE ALL ON FUNCTION public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz, text, uuid, boolean, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_apply_expense(uuid, uuid, uuid, text, text, date, character, bigint, text, jsonb, jsonb, jsonb, uuid, text, uuid, integer, jsonb, text, text, text, jsonb, jsonb, text, boolean, bigint, date, timestamptz, text, uuid, boolean, uuid) TO service_role;

CREATE FUNCTION public.waves_record_pot_settlement(p_pot_id uuid, p_from_member_id uuid,
  p_to_member_id uuid, p_amount bigint, p_client_mutation_id uuid,
  p_reference text DEFAULT NULL, p_reference_source public."SettlementReferenceSource" DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE p pots; v_id uuid; existing settlements;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pots WHERE id = p_pot_id AND is_group_member(group_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT p FROM pots WHERE id = p_pot_id FOR UPDATE;
  IF p_client_mutation_id IS NULL THEN RAISE EXCEPTION 'MUTATION_ID_REQUIRED'; END IF;
  SELECT * INTO existing FROM settlements WHERE client_mutation_id = p_client_mutation_id;
  IF FOUND THEN
    IF existing.pot_id IS DISTINCT FROM p.id OR existing.from_member_id <> p_from_member_id OR
       existing.to_member_id <> p_to_member_id OR existing.amount <> p_amount THEN
      RAISE EXCEPTION 'MUTATION_CONFLICT';
    END IF;
    RETURN existing.id;
  END IF;
  IF p.status <> 'open' OR (p_from_member_id <> p.treasurer_member_id AND p_to_member_id <> p.treasurer_member_id) THEN
    RAISE EXCEPTION 'POT_INVALID_SETTLEMENT';
  END IF;
  -- Delegate payer authorization and normal notifications to the existing RPC.
  v_id := waves_record_settlement(p.group_id, p_from_member_id, p_to_member_id, p_amount,
    'upi', p.currency, NULL, '[]'::jsonb, p_client_mutation_id, 'upi');
  UPDATE settlements SET pot_id = p.id, reference = p_reference, reference_source = p_reference_source WHERE id = v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.waves_record_pot_settlement(uuid, uuid, uuid, bigint, uuid, text, public."SettlementReferenceSource") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_record_pot_settlement(uuid, uuid, uuid, bigint, uuid, text, public."SettlementReferenceSource") TO authenticated, service_role;

-- Lifecycle transitions and direct expense pointer changes share the pot lock.
-- Otherwise a delete/restore could change the close calculation after close.
CREATE FUNCTION public.waves_guard_pot_expense_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE old_pot uuid; new_pot uuid; p pots;
BEGIN
  IF (NEW.current_version_id, NEW.deleted_at) IS NOT DISTINCT FROM (OLD.current_version_id, OLD.deleted_at) THEN RETURN NEW; END IF;
  SELECT pot_id INTO old_pot FROM expense_versions WHERE id = OLD.current_version_id;
  SELECT pot_id INTO new_pot FROM expense_versions WHERE id = NEW.current_version_id;
  IF OLD.current_version_id IS NOT NULL AND old_pot IS DISTINCT FROM new_pot THEN
    RAISE EXCEPTION 'POT_IMMUTABLE_EXPENSE';
  END IF;
  IF COALESCE(old_pot, new_pot) IS NOT NULL THEN
    SELECT * INTO STRICT p FROM pots WHERE id = COALESCE(old_pot, new_pot) FOR UPDATE;
    IF p.status <> 'open' THEN RAISE EXCEPTION 'POT_NOT_OPEN'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.waves_guard_pot_expense_pointer() FROM PUBLIC;
CREATE TRIGGER pot_expense_pointer_guard BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.waves_guard_pot_expense_pointer();
REVOKE ALL ON FUNCTION public.waves_guard_pot() FROM PUBLIC;

CREATE FUNCTION public.waves_create_pot(p_group_id uuid, p_name text, p_currency char(3),
  p_per_head_minor bigint, p_treasurer_member_id uuid, p_client_mutation_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE v_actor uuid; existing pots; v_id uuid;
BEGIN
  v_actor := waves_my_member_id(p_group_id);
  IF v_actor IS NULL OR NOT is_group_member(p_group_id) OR
     (NOT is_group_admin(p_group_id) AND v_actor <> p_treasurer_member_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_client_mutation_id IS NULL THEN RAISE EXCEPTION 'MUTATION_ID_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pot-create:' || p_client_mutation_id::text, 0));
  SELECT * INTO existing FROM pots WHERE client_mutation_id = p_client_mutation_id;
  IF FOUND THEN
    IF (existing.group_id, existing.name, existing.currency, existing.per_head_minor, existing.treasurer_member_id)
      IS DISTINCT FROM (p_group_id, p_name, upper(p_currency)::char(3), p_per_head_minor, p_treasurer_member_id) THEN
      RAISE EXCEPTION 'MUTATION_CONFLICT';
    END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO pots(group_id, name, currency, per_head_minor, treasurer_member_id, created_by, client_mutation_id)
    VALUES (p_group_id, p_name, upper(p_currency), p_per_head_minor, p_treasurer_member_id, v_actor, p_client_mutation_id)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.waves_create_pot(uuid, text, character, bigint, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_create_pot(uuid, text, character, bigint, uuid, uuid) TO authenticated, service_role;
