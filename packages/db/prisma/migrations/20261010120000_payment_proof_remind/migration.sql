-- Payment detail: remind to confirm, several proofs, a paid date.
--
-- A payment the payer has recorded sits "waiting for confirmation" until the
-- payee answers. This migration gives the payer three things on that card:
--
--   1. A reminder. `waves_remind_settlement_confirm` pushes the payee (same
--      inbox kind as the original request, so every build already renders it)
--      or, for a payee not on Waves, only stamps the cooldown and tells the app
--      to hand the message to WhatsApp / the share sheet. One reminder per
--      payment per 24 hours, enforced here, not in the app.
--   2. More than one proof. The old rule was one live proof per settlement,
--      enforced only inside `waves_attach_settlement_proof`; it is now five.
--      Removing a proof is the payer's or a group admin's (it used to be either
--      party, but no build ever offered the payee a remove button).
--   3. A paid date, separate from when the row was recorded. `paid_at` is the
--      day the money moved: defaults to the recorded day, existing rows are
--      backfilled from `initiated_at`, and the payer can correct it.
--
-- Old app builds keep working: every new parameter has a default, the pull
-- simply ignores the new columns, and a build that only knows one proof shows
-- the first of several.

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

UPDATE public.settlements SET paid_at = (initiated_at AT TIME ZONE 'UTC')::date WHERE paid_at IS NULL;

-- The backfill queues `settlements_refresh_balances`, a deferred trigger, once
-- per row; ALTER TABLE refuses to run while those are pending ("pending trigger
-- events"). Fire them now, inside this migration, rather than at commit.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.settlements
  ALTER COLUMN paid_at SET DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  ALTER COLUMN paid_at SET NOT NULL;

COMMENT ON COLUMN public.settlements.paid_at IS
  'The day the money moved (UTC date). Defaults to the day recorded; the payer may correct it.';
COMMENT ON COLUMN public.settlements.reminded_at IS
  'When the payer last asked the payee to confirm. At most one reminder per 24 hours.';

-- ───────────────────────────────────────────────────── record with a paid date ──

-- A new trailing parameter changes the signature, so the old function goes. A
-- call with the old ten named arguments still resolves to the new one.
DROP FUNCTION IF EXISTS public.waves_record_settlement(uuid, uuid, uuid, bigint, text, character, text, jsonb, uuid, text);

CREATE FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character DEFAULT NULL::bpchar, p_note text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_client_mutation_id uuid DEFAULT NULL::uuid, p_rail text DEFAULT NULL::text, p_paid_at date DEFAULT NULL::date) RETURNS uuid
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
                             'paidAt', v_paid_at));

  PERFORM public.waves_record_agent_write(
    'settlement.record', p_group_id, v_settlement_id, p_amount, upper(v_currency)
  );

  IF v_actor = p_from_member_id THEN
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
      ),
      'settle_confirm_req:' || v_settlement_id::text
    );
  END IF;

  RETURN v_settlement_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text, p_paid_at date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text, p_paid_at date) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────── correct the date ──

CREATE FUNCTION public.waves_set_settlement_paid_at(p_settlement_id uuid, p_paid_at date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_parties record;
  v_status  public."SettlementStatus";
BEGIN
  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: a payment needs a date' USING ERRCODE = 'check_violation';
  END IF;
  IF p_paid_at > (now() AT TIME ZONE 'UTC')::date + 1 THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: a payment cannot be dated in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_status FROM public.settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no such settlement' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_parties FROM public.waves_settlement_parties(p_settlement_id);
  IF v_parties.payer_profile IS DISTINCT FROM public.waves_current_profile_id() THEN
    RAISE EXCEPTION 'NOT_THE_PAYER: only the person who paid may change the date'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A confirmed payment is what the payee agreed to; its date is part of that.
  IF v_status NOT IN ('initiated', 'disputed') THEN
    RAISE EXCEPTION 'NOT_EDITABLE: this payment has already been settled'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.settlements SET paid_at = p_paid_at WHERE id = p_settlement_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_set_settlement_paid_at(p_settlement_id uuid, p_paid_at date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_set_settlement_paid_at(p_settlement_id uuid, p_paid_at date) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────── the reminder ──

-- Returns 'notified' when the payee has an inbox (a push was queued) and
-- 'external' when they are not on Waves yet (the app sends the message itself;
-- the cooldown is stamped here either way). REMIND_RATE_LIMIT when the last
-- reminder was less than 24 hours ago.
CREATE FUNCTION public.waves_remind_settlement_confirm(p_settlement_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_parties record;
  v_status  public."SettlementStatus";
  v_stamped timestamptz;
BEGIN
  SELECT status INTO v_status FROM public.settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no such settlement' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_parties FROM public.waves_settlement_parties(p_settlement_id);
  IF v_parties.payer_profile IS DISTINCT FROM public.waves_current_profile_id() THEN
    RAISE EXCEPTION 'NOT_THE_PAYER: only the person who paid may remind'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_status <> 'initiated' THEN
    RAISE EXCEPTION 'NOT_PENDING: this payment is no longer waiting for confirmation'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Claim the slot atomically: two taps racing cannot both pass.
  UPDATE public.settlements
     SET reminded_at = now()
   WHERE id = p_settlement_id
     AND (reminded_at IS NULL OR reminded_at <= now() - interval '24 hours')
  RETURNING reminded_at INTO v_stamped;

  IF v_stamped IS NULL THEN
    RAISE EXCEPTION 'REMIND_RATE_LIMIT: you reminded them in the last 24 hours'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_parties.payee_profile IS NULL THEN
    RETURN 'external';
  END IF;

  PERFORM public.waves_notify(
    v_parties.payee_profile,
    v_parties.group_id,
    'settlement_confirm_request',
    COALESCE(v_parties.payer_name, 'Someone') || ' says they paid you',
    'Confirm it so your balance stays right',
    'waves://group/' || v_parties.group_id::text,
    jsonb_build_object(
      'settlementId', p_settlement_id,
      'amount', v_parties.amount,
      'currency', v_parties.currency,
      'role', 'payee',
      'counterparty', v_parties.payer_name,
      'group', v_parties.group_name,
      'reminder', true
    ),
    'settle_confirm_remind:' || p_settlement_id::text || ':'
      || floor(extract(epoch FROM v_stamped))::text
  );

  RETURN 'notified';
END
$$;

REVOKE ALL ON FUNCTION public.waves_remind_settlement_confirm(p_settlement_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_remind_settlement_confirm(p_settlement_id uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────── up to 5 proofs ──

-- Restated from the baseline with one change: the "one live proof" rule becomes
-- "at most five", counted under a per-settlement lock so two uploads racing
-- cannot both take the fifth slot.
CREATE OR REPLACE FUNCTION public.waves_attach_settlement_proof(p_settlement_id uuid, p_storage_path text, p_proof_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group_id uuid;
  v_member   uuid;
  v_id       uuid;
  v_max      constant integer := 5;
BEGIN
  IF coalesce(btrim(p_storage_path), '') = '' THEN
    RAISE EXCEPTION 'INVALID_PATH: a proof needs a stored image' USING ERRCODE = 'check_violation';
  END IF;

  IF p_storage_path NOT LIKE p_settlement_id::text || '/%' THEN
    RAISE EXCEPTION 'INVALID_PATH: the key must be scoped to its settlement'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT group_id INTO v_group_id FROM public.settlements WHERE id = p_settlement_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: no such settlement' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.waves_is_settlement_party(p_settlement_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTY: only the payer or payee may attach a proof'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_proof_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.settlement_proofs
    WHERE id = p_proof_id AND settlement_id = p_settlement_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  PERFORM public.waves_require_committed_object('settlement-proofs', btrim(p_storage_path));

  PERFORM pg_advisory_xact_lock(hashtextextended('settlement-proofs:' || p_settlement_id::text, 0));

  IF (
    SELECT count(*) FROM public.settlement_proofs
    WHERE settlement_id = p_settlement_id AND deleted_at IS NULL
  ) >= v_max THEN
    RAISE EXCEPTION 'PROOF_LIMIT: a payment can have at most % proofs; remove one first', v_max
      USING ERRCODE = 'check_violation';
  END IF;

  v_member := public.waves_my_member_id(v_group_id);

  INSERT INTO public.settlement_proofs
    (id, settlement_id, group_id, uploader_member_id, storage_path)
  VALUES
    (COALESCE(p_proof_id, gen_random_uuid()), p_settlement_id, v_group_id, v_member,
     btrim(p_storage_path))
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_attach_settlement_proof(p_settlement_id uuid, p_storage_path text, p_proof_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_attach_settlement_proof(p_settlement_id uuid, p_storage_path text, p_proof_id uuid) TO authenticated, service_role;

-- Removing one proof: the payer, or an admin of the group.
CREATE OR REPLACE FUNCTION public.waves_remove_settlement_proof(p_proof_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_settlement_id uuid;
  v_group_id      uuid;
  v_parties       record;
BEGIN
  SELECT settlement_id, group_id INTO v_settlement_id, v_group_id
  FROM public.settlement_proofs WHERE id = p_proof_id;
  IF v_settlement_id IS NULL THEN
    RETURN; -- Already gone.
  END IF;

  SELECT * INTO v_parties FROM public.waves_settlement_parties(v_settlement_id);
  IF v_parties.payer_profile IS DISTINCT FROM public.waves_current_profile_id()
     AND NOT public.is_group_admin(v_group_id) THEN
    -- A stranger learns nothing about the proof; a party who is not the payer
    -- is told why.
    IF NOT public.waves_is_settlement_party(v_settlement_id) THEN
      RAISE EXCEPTION 'NOT_A_PARTY: only a party may remove a proof'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'NOT_THE_PAYER: only the payer or a group admin may remove a proof'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.settlement_proofs
     SET deleted_at = now()
   WHERE id = p_proof_id AND deleted_at IS NULL;
END
$$;

REVOKE ALL ON FUNCTION public.waves_remove_settlement_proof(p_proof_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_remove_settlement_proof(p_proof_id uuid) TO authenticated, service_role;
