-- A simplified transfer with no direct debt deliberately omits "of Y" rather than showing a wrong denominator.
-- A part payment says so: the "X says they paid you" notice carries `owed`, what
-- was owed before it, whenever the payment is smaller. The app renders it as
-- "paid ₹2,000 of ₹5,000" (the activity row carries it too). Same function as 20261226090000 plus v_owed; no
-- amount rule changes (any positive amount was and is accepted).
CREATE OR REPLACE FUNCTION public.waves_guard_settlement_allocation_group() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_expense_group_id uuid;
  v_settlement_group_id uuid;
BEGIN
  SELECT group_id INTO v_settlement_group_id
  FROM public.settlements WHERE id = NEW.settlement_id;
  SELECT group_id INTO v_expense_group_id
  FROM public.expenses WHERE id = NEW.expense_id;
  IF v_expense_group_id IS NULL OR v_settlement_group_id IS NULL
     OR v_expense_group_id <> v_settlement_group_id THEN
    RAISE EXCEPTION 'INVALID_ALLOCATION: expense and settlement must belong to the same group'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_guard_settlement_allocation_group() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_guard_settlement_allocation_group() TO service_role;

CREATE TRIGGER settlement_allocations_group_guard
BEFORE INSERT OR UPDATE OF settlement_id, expense_id ON public.settlement_allocations
FOR EACH ROW EXECUTE FUNCTION public.waves_guard_settlement_allocation_group();

CREATE OR REPLACE FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character DEFAULT NULL::bpchar, p_note text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_client_mutation_id uuid DEFAULT NULL::uuid, p_rail text DEFAULT NULL::text, p_paid_at date DEFAULT NULL::date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_settlement_id uuid;
  v_currency      char(3);
  v_group_currency char(3);
  v_converts      boolean;
  v_actor         uuid;
  v_allocation    jsonb;
  v_rail          text := COALESCE(NULLIF(btrim(p_rail), ''), p_method);
  v_parties       record;
  v_paid_at       date;
  v_owed          bigint;
  v_inserted_id   uuid;
BEGIN
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in this group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_actor := public.waves_my_member_id(p_group_id);
  IF v_actor IS NULL OR v_actor NOT IN (p_from_member_id, p_to_member_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTY: you can only record a settlement you are part of'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.id = p_from_member_id AND gm.group_id = p_group_id
      )
     OR NOT EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.id = p_to_member_id AND gm.group_id = p_group_id
      ) THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: both parties must be members of this group'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: settle a positive amount' USING ERRCODE = 'check_violation';
  END IF;

  -- A retry of a request already recorded answers at once; a reused id for a
  -- different payment (or group) is refused, never answered with the other row.
  IF p_client_mutation_id IS NOT NULL THEN
    SELECT * INTO v_parties FROM public.settlements WHERE client_mutation_id = p_client_mutation_id;
    IF FOUND THEN
      IF v_parties.group_id = p_group_id
         AND v_parties.from_member_id = p_from_member_id
         AND v_parties.to_member_id = p_to_member_id
         AND v_parties.amount = p_amount
         AND upper(v_parties.currency) = upper(COALESCE(p_currency, (SELECT default_currency FROM public.groups WHERE id = p_group_id))) THEN
        RETURN v_parties.id;
      END IF;
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: this request id was used for a different payment'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  SELECT COALESCE(p_currency, default_currency), default_currency, convert_to_group_currency
    INTO v_currency, v_group_currency, v_converts
  FROM public.groups WHERE id = p_group_id;

  -- ── new: a converting group settles in its own currency only ────────────
  -- Its foreign bills already count in the group currency, so a payment in
  -- theirs would sit in a bucket nobody owes anything in. Only an old build
  -- sends one; the code tells it to ask for an update (ADR-003 amendment).
  IF v_converts AND upper(v_currency) <> v_group_currency THEN
    RAISE EXCEPTION 'UPDATE_APP_TO_SETTLE: this group settles in %, not %; update Waves to settle up',
      v_group_currency, upper(v_currency)
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate allocations before creating the settlement. Converting groups
  -- settle in group currency, so foreign-currency source expenses are valid.
  FOR v_allocation IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    IF (v_allocation ->> 'amount') IS NULL OR (v_allocation ->> 'amount')::bigint <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION: amount must be positive' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.expenses e
      JOIN public.expense_versions ev ON ev.id = e.current_version_id
      WHERE e.id = (v_allocation ->> 'expenseId')::uuid
        AND e.group_id = p_group_id
        AND e.deleted_at IS NULL
        AND (v_converts OR upper(ev.currency) = upper(v_currency))
      FOR SHARE OF e
    ) THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION: expense must be active in this group and currency'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  PERFORM public.waves_assert_agent_cap(p_amount);

  -- The day the money moved. Default today (UTC); a day further ahead than any
  -- timezone can be is a typo, not a payment.
  v_paid_at := COALESCE(p_paid_at, (now() AT TIME ZONE 'UTC')::date);
  IF v_paid_at > (now() AT TIME ZONE 'UTC')::date + 1 THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: a payment cannot be dated in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  -- What the payer owed the payee in this currency before this payment
  -- (the new row is still 'initiated', which the view does not count).
  SELECT COALESCE(
           (SELECT amount FROM public.pairwise_balances
             WHERE group_id = p_group_id AND from_member_id = p_from_member_id
               AND to_member_id = p_to_member_id AND currency = upper(v_currency)), 0)
       - COALESCE(
           (SELECT amount FROM public.pairwise_balances
             WHERE group_id = p_group_id AND from_member_id = p_to_member_id
               AND to_member_id = p_from_member_id AND currency = upper(v_currency)), 0)
    INTO v_owed;

  INSERT INTO public.settlements
    (group_id, from_member_id, to_member_id, currency, amount, method, rail, status, note,
     client_mutation_id, paid_at)
  VALUES
    (p_group_id, p_from_member_id, p_to_member_id, upper(v_currency), p_amount,
     CASE WHEN p_method IN ('upi', 'cash', 'bank', 'other') THEN p_method ELSE 'other' END
       ::"SettlementMethod",
     v_rail, 'initiated', p_note, p_client_mutation_id, v_paid_at)
  ON CONFLICT (client_mutation_id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    SELECT * INTO v_parties FROM public.settlements
    WHERE client_mutation_id = p_client_mutation_id;
    IF v_parties.group_id = p_group_id
       AND v_parties.from_member_id = p_from_member_id
       AND v_parties.to_member_id = p_to_member_id
       AND v_parties.amount = p_amount
       AND upper(v_parties.currency) = upper(v_currency) THEN
      RETURN v_parties.id;
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED: this request id was used for a different payment'
      USING ERRCODE = 'unique_violation';
  END IF;
  v_settlement_id := v_inserted_id;

  FOR v_allocation IN SELECT * FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    INSERT INTO public.settlement_allocations (settlement_id, expense_id, amount)
    VALUES (
      v_settlement_id,
      (v_allocation ->> 'expenseId')::uuid,
      (v_allocation ->> 'amount')::bigint
    )
    ON CONFLICT (settlement_id, expense_id)
    DO UPDATE SET amount = public.settlement_allocations.amount + EXCLUDED.amount;
  END LOOP;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (p_group_id, v_actor, 'settled', 'settlement', v_settlement_id,
          jsonb_build_object('amount', p_amount::text, 'currency', upper(v_currency),
                             'method', p_method, 'rail', v_rail,
                             'paidAt', v_paid_at)
          || CASE WHEN v_owed > p_amount
                  THEN jsonb_build_object('owed', v_owed::text) ELSE '{}'::jsonb END);

  PERFORM public.waves_record_agent_write(
    'settlement.record', p_group_id, v_settlement_id, p_amount, upper(v_currency)
  );

  IF v_actor = p_to_member_id AND p_from_member_id <> p_to_member_id THEN
    -- The person who was paid is recording it: their say-so IS the confirmation
    -- (ADR-007 only guards against the payer vouching for themselves). Going
    -- through the same UPDATE as waves_confirm_settlement keeps the transition
    -- guard, confirmed_at and the payer's "confirmed" notice working. Without
    -- this the receiver's row waited 7 days, and a placeholder payer never
    -- could confirm anything.
    UPDATE public.settlements SET status = 'confirmed' WHERE id = v_settlement_id;
    INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (p_group_id, v_actor, 'confirmed', 'settlement', v_settlement_id, '{}'::jsonb);
  ELSIF v_actor = p_from_member_id THEN
    SELECT * INTO v_parties FROM public.waves_settlement_parties(v_settlement_id);
    PERFORM public.waves_notify(
      v_parties.payee_profile,
      p_group_id,
      'settlement_confirm_request',
      COALESCE(v_parties.payer_name, 'Someone') || ' says they paid you',
      'Confirm it so your balance stays right',
      'waves://group/' || p_group_id::text,
      jsonb_build_object(
        'settlementId', v_settlement_id,
        'amount', v_parties.amount,
        'currency', v_parties.currency,
        'role', 'payee',
        'counterparty', v_parties.payer_name,
        'group', v_parties.group_name
      ) || CASE WHEN v_owed > p_amount
                THEN jsonb_build_object('owed', v_owed::text) ELSE '{}'::jsonb END,
      'settle_confirm_req:' || v_settlement_id::text
    );
  END IF;

  RETURN v_settlement_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text, p_paid_at date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text, p_paid_at date) TO authenticated, service_role;
