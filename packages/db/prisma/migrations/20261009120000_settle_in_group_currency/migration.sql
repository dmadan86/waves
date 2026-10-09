-- A group settles in its own currency (ADR-003 amendment).
--
-- A bill paid in a foreign currency, with a rate stored on its version
-- (`expense_versions.fx`), counts toward balances in the group's currency at
-- that rate — never today's. The converted total is convert(amount, fx),
-- rounded half away from zero ONCE; payers and shares are then apportioned over
-- it by largest remainder (ties to the smaller member id, byte order), so every
-- bill still sums to zero in the currency it settles in (ADR-004). A bill with
-- no usable rate stays in its own currency. Nothing is rewritten: the original
-- amount and rate stay on the version, and balances move only when a bill or a
-- settlement is edited.
--
-- The client does the identical arithmetic in @waves/core
-- (packages/core/src/balances/convert.ts). packages/db/test/settle-in-group-
-- currency.test.ts holds the two to the same numbers on random ledgers.
--
-- Rollout:
--   * `groups.convert_to_group_currency`, default false: every existing group
--     keeps its per-currency balances, unchanged, until an admin opts in.
--   * `waves_create_group` creates every NEW group with it on (server-side, so
--     every client — old builds included — gets the same rule).
--   * Opting in (`waves_set_group_convert`) is refused until the group is
--     ready (`waves_group_currency_readiness`): every live foreign bill has a
--     rate into the group currency and no foreign-currency settlement exists.
--   * In a converting group `waves_record_settlement` refuses a settlement in
--     any other currency with UPDATE_APP_TO_SETTLE — an old build would
--     otherwise record a ₫ payment against a debt that now lives in ₹.
--   * A group's currency is frozen once it has a bill, a trip rate or a
--     settlement (`waves_guard_group_columns`): every stored rate converts INTO
--     it, so changing it would silently re-denominate the ledger.
--
-- `waves_check_settlement_allocations` is unchanged on purpose. It only bounds
-- Σ allocations by the settlement's own amount, in the settlement's own
-- currency. The client now allocates against the CONVERTED bill (whose shares
-- are in the group currency, like the settlement), so the bound still compares
-- like with like.

-- ─────────────────────────────────────────────────────────────── the switch ──

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS convert_to_group_currency boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.groups.convert_to_group_currency IS
  'When true, a foreign-currency bill with a stored rate counts toward balances in default_currency at that rate (ADR-003 amendment). Set only through waves_set_group_convert; new groups start true.';

-- ─────────────────────────────────────────────────────────────── helpers ──

-- Minor-unit exponent. The copy of `EXPONENTS` in packages/core/src/money/
-- currency.ts; the DB suite compares every entry of that table with this.
CREATE OR REPLACE FUNCTION public.waves_currency_exponent(p_currency text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN p_currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
                        'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 0
    WHEN p_currency IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 3
    ELSE 2
  END
$$;

-- Whether a version's stored fx can convert it into the group's currency. The
-- twin of `usableFx` in core: an object whose `from` is the bill's currency,
-- whose `to` is the GROUP's currency (p_to, different from the bill's), and
-- whose num/den are positive integers written as JSON strings. Anything else —
-- including a rate into some third currency — is "no rate" on both sides, so a
-- converting group never grows a bucket in a currency it does not settle in.
-- plpgsql so the checks run in order — the numeric casts are only reached once
-- the regex has passed.
CREATE OR REPLACE FUNCTION public.waves_fx_usable(p_fx jsonb, p_currency text, p_to text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_fx IS NULL OR jsonb_typeof(p_fx) <> 'object' THEN RETURN false; END IF;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN RETURN false; END IF;
  IF p_to IS NULL OR p_to !~ '^[A-Z]{3}$' OR p_to = p_currency THEN RETURN false; END IF;
  IF jsonb_typeof(p_fx -> 'from') IS DISTINCT FROM 'string'
     OR (p_fx ->> 'from') <> p_currency THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_fx -> 'to') IS DISTINCT FROM 'string'
     OR (p_fx ->> 'to') <> p_to THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_fx -> 'num') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_fx -> 'den') IS DISTINCT FROM 'string'
     OR (p_fx ->> 'num') !~ '^[0-9]+$'
     OR (p_fx ->> 'den') !~ '^[0-9]+$' THEN
    RETURN false;
  END IF;
  RETURN (p_fx ->> 'num')::numeric > 0 AND (p_fx ->> 'den')::numeric > 0;
END
$$;

-- Every live bill's payers and shares, per member, in the currency the bill
-- settles in. A bill that converts is apportioned over its converted total; a
-- bill that does not is passed through untouched. All arithmetic is exact
-- numeric (no bigint overflow on amount × num), with integer div/mod only.
CREATE OR REPLACE FUNCTION public.waves_group_expense_lines(p_group_id uuid)
RETURNS TABLE(expense_version_id uuid, member_id uuid, currency character, paid bigint, owed bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH grp AS (
    SELECT g.convert_to_group_currency AS converts,
           btrim(g.default_currency::text) AS settle_cur
      FROM public.groups g
     WHERE g.id = p_group_id
  ),
  live AS (
    SELECT ev.id,
           ev.currency::text AS cur,
           ev.amount::numeric AS amount,
           ev.fx,
           COALESCE((SELECT converts FROM grp), false)
             AND public.waves_fx_usable(ev.fx, ev.currency::text,
                                        (SELECT settle_cur FROM grp)) AS converts
      FROM public.expense_versions ev
      JOIN public.expenses e
        ON e.id = ev.expense_id
       AND e.current_version_id = ev.id
       AND e.deleted_at IS NULL
     WHERE e.group_id = p_group_id
  ),
  scaled AS (
    -- 1 minor unit of `from` = n / d minor units of `to`:
    --   n = num · 10^max(Δ, 0),  d = den · 10^max(−Δ, 0),  Δ = exp(to) − exp(from)
    SELECT l.id, l.amount, l.converts,
           CASE WHEN l.converts THEN l.fx ->> 'to' ELSE l.cur END AS settle_cur,
           CASE WHEN l.converts
                THEN (l.fx ->> 'num')::numeric
                     * ('1' || repeat('0', greatest(x.e_to - x.e_from, 0)))::numeric
                ELSE 1::numeric END AS n,
           CASE WHEN l.converts
                THEN (l.fx ->> 'den')::numeric
                     * ('1' || repeat('0', greatest(x.e_from - x.e_to, 0)))::numeric
                ELSE 1::numeric END AS d
      FROM live l
      CROSS JOIN LATERAL (
        SELECT public.waves_currency_exponent(l.cur) AS e_from,
               public.waves_currency_exponent(
                 CASE WHEN l.converts THEN l.fx ->> 'to' ELSE l.cur END) AS e_to
      ) x
  ),
  rated AS (
    -- convert(amount, fx): the exact rational, rounded half away from zero once.
    -- amount ≥ 0 (CHECK), so that is "round up when 2·remainder ≥ d".
    SELECT s.*,
           div(s.amount * s.n, s.d)
             + CASE WHEN 2 * mod(s.amount * s.n, s.d) >= s.d THEN 1 ELSE 0 END AS total
      FROM scaled s
  ),
  weights AS (
    SELECT 'paid'::text AS side, p.expense_version_id AS vid, p.member_id,
           SUM(p.amount)::numeric AS w
      FROM public.expense_payers p
      JOIN rated r ON r.id = p.expense_version_id
     GROUP BY p.expense_version_id, p.member_id
    UNION ALL
    SELECT 'owed'::text, s.expense_version_id, s.member_id, SUM(s.amount)::numeric
      FROM public.expense_shares s
      JOIN rated r ON r.id = s.expense_version_id
     GROUP BY s.expense_version_id, s.member_id
  ),
  quotas AS (
    -- floor(w·n / d), toward −∞ (div truncates toward zero), and what is left.
    SELECT w.side, w.vid, w.member_id, w.w, r.converts, r.total, r.d, q.fl,
           w.w * r.n - q.fl * r.d AS rem
      FROM weights w
      JOIN rated r ON r.id = w.vid
      CROSS JOIN LATERAL (
        SELECT div(w.w * r.n, r.d)
                 - CASE WHEN mod(w.w * r.n, r.d) < 0 THEN 1 ELSE 0 END AS fl
      ) q
  ),
  ranked AS (
    SELECT qu.*,
           qu.total - SUM(qu.fl) OVER (PARTITION BY qu.side, qu.vid) AS leftover,
           row_number() OVER (PARTITION BY qu.side, qu.vid
                              ORDER BY qu.rem DESC, qu.member_id) AS rnk
      FROM quotas qu
  ),
  apportioned AS (
    SELECT rk.side, rk.vid, rk.member_id,
           CASE WHEN rk.converts
                THEN rk.fl + CASE WHEN rk.rnk <= rk.leftover THEN 1 ELSE 0 END
                ELSE rk.w END AS v
      FROM ranked rk
  )
  SELECT a.vid,
         a.member_id,
         r.settle_cur::char(3),
         COALESCE(SUM(a.v) FILTER (WHERE a.side = 'paid'), 0)::bigint,
         COALESCE(SUM(a.v) FILTER (WHERE a.side = 'owed'), 0)::bigint
    FROM apportioned a
    JOIN rated r ON r.id = a.vid
   GROUP BY a.vid, a.member_id, r.settle_cur
$$;

-- Every ledger movement of a group: bill lines (paid − owed, in the currency the
-- bill settles in) and confirmed settlements.
CREATE OR REPLACE FUNCTION public.waves_group_movements(p_group_id uuid)
RETURNS TABLE(member_id uuid, currency character, delta bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT l.member_id, l.currency, l.paid - l.owed
    FROM public.waves_group_expense_lines(p_group_id) l
  UNION ALL
  SELECT st.from_member_id, st.currency, st.amount
    FROM public.settlements st
   WHERE st.group_id = p_group_id AND st.status IN ('confirmed', 'auto_confirmed')
  UNION ALL
  SELECT st.to_member_id, st.currency, -st.amount
    FROM public.settlements st
   WHERE st.group_id = p_group_id AND st.status IN ('confirmed', 'auto_confirmed')
$$;

-- ───────────────────────────────────────────────────── the derived truth ──

CREATE OR REPLACE FUNCTION public.waves_group_balances_truth(p_group_id uuid)
RETURNS TABLE(member_id uuid, currency character, balance bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT m.member_id, m.currency, SUM(m.delta)::bigint AS balance
    FROM public.waves_group_movements(p_group_id) m
   GROUP BY m.member_id, m.currency
  HAVING SUM(m.delta) <> 0
$$;

-- Same north-west-corner fill per bill as before (and as core's
-- `pairwiseForExpense`), now over the converted lines.
CREATE OR REPLACE FUNCTION public.waves_group_pairwise_truth(p_group_id uuid)
RETURNS TABLE(from_member_id uuid, to_member_id uuid, currency character, amount bigint)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
DECLARE
  v_version      RECORD;
  v_debtor_ids   uuid[];
  v_debtor_amts  bigint[];
  v_credit_ids   uuid[];
  v_credit_amts  bigint[];
  d int; c int;
  v_take bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS waves_pairwise_scratch (
    a uuid, b uuid, cur char(3), amt bigint
  ) ON COMMIT DROP;
  DELETE FROM waves_pairwise_scratch WHERE true;

  FOR v_version IN
    SELECT l.expense_version_id AS id,
           l.currency AS cur,
           array_agg(l.member_id ORDER BY l.member_id)
             FILTER (WHERE l.paid - l.owed < 0) AS debtor_ids,
           array_agg(l.owed - l.paid ORDER BY l.member_id)
             FILTER (WHERE l.paid - l.owed < 0) AS debtor_amts,
           array_agg(l.member_id ORDER BY l.member_id)
             FILTER (WHERE l.paid - l.owed > 0) AS credit_ids,
           array_agg(l.paid - l.owed ORDER BY l.member_id)
             FILTER (WHERE l.paid - l.owed > 0) AS credit_amts
      FROM public.waves_group_expense_lines(p_group_id) l
     GROUP BY l.expense_version_id, l.currency
  LOOP
    v_debtor_ids  := v_version.debtor_ids;
    v_debtor_amts := v_version.debtor_amts;
    v_credit_ids  := v_version.credit_ids;
    v_credit_amts := v_version.credit_amts;

    IF v_debtor_ids IS NULL OR v_credit_ids IS NULL THEN
      CONTINUE;
    END IF;

    d := 1; c := 1;
    WHILE d <= array_length(v_debtor_ids, 1) AND c <= array_length(v_credit_ids, 1) LOOP
      v_take := LEAST(v_debtor_amts[d], v_credit_amts[c]);
      IF v_take > 0 THEN
        INSERT INTO waves_pairwise_scratch
        VALUES (v_debtor_ids[d], v_credit_ids[c], v_version.cur, v_take);
        v_debtor_amts[d] := v_debtor_amts[d] - v_take;
        v_credit_amts[c] := v_credit_amts[c] - v_take;
      END IF;
      IF v_debtor_amts[d] = 0 THEN d := d + 1; END IF;
      IF v_credit_amts[c] = 0 THEN c := c + 1; END IF;
    END LOOP;
  END LOOP;

  -- Settlements pay debt down: `from` paying `to` cancels what `from` owes `to`,
  -- which is the same as `to` owing `from` that much (a row means "a owes b").
  --
  -- FIX: the baseline inserted `-st.amount` here, i.e. "`from` owes `to` MORE".
  -- Net balances were never affected (they come from the movements, not from
  -- this table), but every confirmed settlement grew the stored pairwise debt
  -- instead of shrinking it — b paying a ₹50 they owed showed b owing ₹100.
  -- Core's `computePairwiseBalances` always had the right sign; the parity test
  -- in settle-in-group-currency.test.ts is what caught the difference.
  INSERT INTO waves_pairwise_scratch
  SELECT st.to_member_id, st.from_member_id, st.currency, st.amount
  FROM public.settlements st
  WHERE st.group_id = p_group_id AND st.status IN ('confirmed', 'auto_confirmed');

  RETURN QUERY
  WITH canonical AS (
    SELECT
      LEAST(a, b) AS lo,
      GREATEST(a, b) AS hi,
      cur,
      SUM(CASE WHEN a < b THEN amt ELSE -amt END)::bigint AS net
    FROM waves_pairwise_scratch
    GROUP BY 1, 2, 3
  )
  SELECT
    CASE WHEN net > 0 THEN lo ELSE hi END,
    CASE WHEN net > 0 THEN hi ELSE lo END,
    cur,
    abs(net)::bigint
  FROM canonical
  WHERE net <> 0;
END
$$;

-- ──────────────────────────────────────────────────── opting a group in ──

-- Per foreign currency: live bills that would NOT convert into the group
-- currency (no usable rate, or a rate into some other currency), and
-- settlements recorded in it that are not cancelled (a pending or disputed one
-- can still become confirmed). The switch turns on only when every count is 0.
CREATE OR REPLACE FUNCTION public.waves_group_currency_readiness(p_group_id uuid)
RETURNS TABLE(currency character, missing_rates integer, foreign_settlements integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
DECLARE
  v_currency text;
BEGIN
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in this group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT btrim(g.default_currency::text) INTO v_currency FROM public.groups g WHERE g.id = p_group_id;

  RETURN QUERY
  WITH bills AS (
    SELECT ev.currency::text AS cur, count(*)::int AS n
      FROM public.expense_versions ev
      JOIN public.expenses e
        ON e.id = ev.expense_id
       AND e.current_version_id = ev.id
       AND e.deleted_at IS NULL
     WHERE e.group_id = p_group_id
       AND ev.currency::text <> v_currency
       AND NOT public.waves_fx_usable(ev.fx, ev.currency::text, v_currency)
     GROUP BY 1
  ),
  pays AS (
    SELECT st.currency::text AS cur, count(*)::int AS n
      FROM public.settlements st
     WHERE st.group_id = p_group_id
       AND st.status <> 'cancelled'
       AND st.currency::text <> v_currency
     GROUP BY 1
  )
  SELECT COALESCE(b.cur, p.cur)::char(3), COALESCE(b.n, 0), COALESCE(p.n, 0)
    FROM bills b
    FULL JOIN pays p ON p.cur = b.cur
   ORDER BY 1;
END
$$;

REVOKE ALL ON FUNCTION public.waves_group_currency_readiness(p_group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_currency_readiness(p_group_id uuid) TO authenticated, service_role;

-- Admin-only. On: refused until ready. Off: refused once any settlement exists,
-- because settlements recorded against converted debts would then be left
-- paying down a currency that no longer holds those debts.
CREATE OR REPLACE FUNCTION public.waves_set_group_convert(p_group_id uuid, p_on boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now boolean;
BEGIN
  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes how the group settles'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'INVALID_VALUE: say on or off' USING ERRCODE = 'check_violation';
  END IF;

  SELECT convert_to_group_currency INTO v_now
    FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF v_now IS NULL THEN
    RAISE EXCEPTION 'NO_SUCH_GROUP' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_now = p_on THEN
    RETURN;
  END IF;

  IF p_on THEN
    IF EXISTS (
      SELECT 1 FROM public.waves_group_currency_readiness(p_group_id) r
       WHERE r.missing_rates > 0 OR r.foreign_settlements > 0
    ) THEN
      RAISE EXCEPTION 'NOT_READY: every foreign bill needs a rate, and no settlement may be in another currency'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.settlements st
       WHERE st.group_id = p_group_id AND st.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'CONVERT_LOCKED: settlements already count in the group currency'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.groups
     SET convert_to_group_currency = p_on, updated_at = now()
   WHERE id = p_group_id;

  PERFORM public.waves_refresh_group_balances(p_group_id);
END
$$;

REVOKE ALL ON FUNCTION public.waves_set_group_convert(p_group_id uuid, p_on boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_set_group_convert(p_group_id uuid, p_on boolean) TO authenticated, service_role;

-- ───────────────────────────────────────────── settling in a converting group ──
--
-- Unchanged from 20260908120000_settlement_notices_and_push_prefs except for
-- the block marked "new".
CREATE OR REPLACE FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character DEFAULT NULL::bpchar, p_note text DEFAULT NULL::text, p_allocations jsonb DEFAULT '[]'::jsonb, p_client_mutation_id uuid DEFAULT NULL::uuid, p_rail text DEFAULT NULL::text) RETURNS uuid
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

  INSERT INTO public.settlements
    (group_id, from_member_id, to_member_id, currency, amount, method, rail, status, note,
     client_mutation_id)
  VALUES
    (p_group_id, p_from_member_id, p_to_member_id, upper(v_currency), p_amount,
     CASE WHEN p_method IN ('upi', 'cash', 'bank', 'other') THEN p_method ELSE 'other' END
       ::"SettlementMethod",
     v_rail, 'initiated', p_note, p_client_mutation_id)
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
                             'method', p_method, 'rail', v_rail));

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

REVOKE ALL ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_record_settlement(p_group_id uuid, p_from_member_id uuid, p_to_member_id uuid, p_amount bigint, p_method text, p_currency character, p_note text, p_allocations jsonb, p_client_mutation_id uuid, p_rail text) TO authenticated, service_role;

-- ──────────────────────────────────────── a group's currency is frozen ──
--
-- Verbatim from 20261006120000_group_custom_tag, plus the block marked "new".
-- That block runs for every writer (service role included), before the
-- role short-circuit: every stored rate converts INTO this currency.
CREATE OR REPLACE FUNCTION public.waves_guard_group_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
    'custom_tag'
  ];
  v_refused text;
BEGIN
  -- ── new: the currency is frozen once the ledger has anything in it ──────
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

  RETURN NEW;
END
$$;

-- ────────────────────────────────────────── new groups convert by default ──
--
-- Verbatim from the baseline, plus `convert_to_group_currency` = true on the
-- INSERT. Server-side so an old build creating a group gets the same rule.
CREATE OR REPLACE FUNCTION public.waves_create_group(p_name text DEFAULT NULL::text, p_type text DEFAULT 'other'::text, p_currency character DEFAULT 'INR'::bpchar, p_emoji text DEFAULT NULL::text, p_simplify boolean DEFAULT true, p_group_id uuid DEFAULT NULL::uuid, p_photo_path text DEFAULT NULL::text, p_country character DEFAULT NULL::bpchar, p_creator_member_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_group_id   uuid;
  v_member_id  uuid;
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_country    char(2) := nullif(btrim(upper(coalesce(p_country, ''))), '');
  v_is_guest   boolean;
  v_created_at timestamptz;
  v_group_count integer;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: a group needs an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_profile_id) THEN
    RAISE EXCEPTION 'NO_PROFILE: profile % does not exist', v_profile_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'GROUP_EXISTS: that group id is already taken'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN p_group_id;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth'
         AND table_name = 'users'
         AND column_name = 'is_anonymous'
     ) THEN
    SELECT u.is_anonymous, u.created_at
      INTO v_is_guest, v_created_at
      FROM auth.users u
      WHERE u.id = v_profile_id;

    IF coalesce(v_is_guest, false) THEN
      IF now() >= v_created_at + interval '10 days' THEN
        RAISE EXCEPTION 'GUEST_TRIAL_EXPIRED: sign up to keep using Waves'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      SELECT count(*) INTO v_group_count
        FROM public.group_members
        WHERE profile_id = v_profile_id AND left_at IS NULL;

      IF v_group_count >= 1 THEN
        RAISE EXCEPTION 'GUEST_GROUP_LIMIT: sign up to be in more than one group'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.groups
    (id, name, type, default_currency, cover_emoji, simplify_debts, created_by, photo_path,
     country_code, convert_to_group_currency)
  VALUES
    (COALESCE(p_group_id, gen_random_uuid()), v_name, p_type::"GroupType",
     upper(p_currency), p_emoji, p_simplify, v_profile_id, p_photo_path,
     COALESCE(v_country, (SELECT country_code FROM public.profiles WHERE id = v_profile_id)),
     true)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (id, group_id, profile_id, role, joined_via)
  VALUES (COALESCE(p_creator_member_id, gen_random_uuid()), v_group_id, v_profile_id, 'admin', 'creator')
  RETURNING id INTO v_member_id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (v_group_id, v_member_id, 'created', 'group', v_group_id,
          jsonb_build_object('name', v_name));

  RETURN v_group_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_create_group(p_name text, p_type text, p_currency character, p_emoji text, p_simplify boolean, p_group_id uuid, p_photo_path text, p_country character, p_creator_member_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_create_group(p_name text, p_type text, p_currency character, p_emoji text, p_simplify boolean, p_group_id uuid, p_photo_path text, p_country character, p_creator_member_id uuid) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────── grants ──

REVOKE ALL ON FUNCTION public.waves_currency_exponent(p_currency text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_currency_exponent(p_currency text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_fx_usable(p_fx jsonb, p_currency text, p_to text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_fx_usable(p_fx jsonb, p_currency text, p_to text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_expense_lines(p_group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_expense_lines(p_group_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_movements(p_group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_movements(p_group_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_balances_truth(p_group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_balances_truth(p_group_id uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_group_pairwise_truth(p_group_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_group_pairwise_truth(p_group_id uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────── refresh the projections ──
--
-- No existing group has the switch on at deploy (it defaults false), so no net
-- balance moves. But the pairwise fix above changes `pairwise_balances` for
-- every group with a confirmed settlement, so those are re-derived now rather
-- than whenever each group is next touched. Groups with the switch on (none at
-- deploy; any flipped by hand) are refreshed too.
DO $do$
DECLARE
  v_group uuid;
BEGIN
  FOR v_group IN
    SELECT g.id FROM public.groups g
     WHERE g.convert_to_group_currency
        OR EXISTS (
          SELECT 1 FROM public.settlements st
           WHERE st.group_id = g.id AND st.status IN ('confirmed', 'auto_confirmed')
        )
  LOOP
    PERFORM public.waves_refresh_group_balances(v_group);
  END LOOP;
END
$do$;
