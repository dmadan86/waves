-- A part payment says so: the "X says they paid you" notice carries `owed`, what
-- was owed before it, whenever the payment is smaller. The app renders it as
-- "paid ₹2,000 of ₹5,000" (the activity row carries it too). Same function as 20261226090000 plus v_owed; no
-- amount rule changes (any positive amount was and is accepted).
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

  IF p_client_mutation_id IS NOT NULL THEN
    SELECT id INTO v_settlement_id
    FROM public.settlements WHERE client_mutation_id = p_client_mutation_id;
    IF v_settlement_id IS NOT NULL THEN
      RETURN v_settlement_id;
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
  RETURNING id INTO v_settlement_id;

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
          jsonb_build_object('amount', p_amount, 'currency', v_currency,
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
