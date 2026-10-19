-- Recurring GROUP expenses: the monthly rent in a flat group.
--
-- WHO GENERATES THE INSTANCES (the decision this migration encodes)
--
--   The SERVER does, on a schedule; every phone also asks it to catch up on
--   open. A phone-only generator (the way the personal ledger does it) would
--   mean the rent is only ever posted when somebody opens the app, once per
--   device, racing the other flatmates' phones. A group expense is shared
--   money that three people read: it has to appear exactly once, on its date,
--   whether or not anybody opened the app that day.
--
--   * `waves_generate_recurring_expenses(p_now)` is the one generator. It is
--     SECURITY DEFINER, service-role/cron only, and posts each due occurrence
--     through `waves_apply_expense` — the same write every other expense takes,
--     so balances, versions, activity and the "expense added" notification all
--     behave exactly as for a hand-typed one.
--   * Idempotent by construction. The expense id AND the client_mutation_id are
--     derived from (rule id, occurrence date), so a double-fire, an overlapping
--     run, a client catch-up racing the cron, or a retry after a crash all hit
--     `waves_apply_expense`'s replay guard and create nothing. Rows are also
--     locked `FOR UPDATE SKIP LOCKED`, so two runs split the work rather than
--     contend.
--   * `waves_generate_my_recurring_expenses(p_today)` is the same generator for
--     the groups the caller is a live member of; the app calls it on open so a
--     rule posts even where the schedule is not enabled (local, self-host).
--   * Scheduled by pg_cron exactly like `waves-weekly-digest` and
--     `waves-prune-receipt-parse-cache`: hourly, guarded so a stack with no
--     pg_cron still migrates. Nothing is deployed by this file.
--
-- The rule stores the expense as already computed (payers and shares in minor
-- units, summing to the amount): the split maths lives in @waves/core, and the
-- amount of a rule is fixed, so SQL never needs to re-implement rounding. Editing
-- a rule recomputes both on the phone and sends them again.
--
-- Dates: an occurrence is `anchor + k * interval` (never "previous + interval"),
-- so a rule on the 31st goes 31, 28, 31, 30, 31 and a Feb 29 yearly rule lands on
-- Feb 28 in common years and returns to Feb 29. `waves_recurring_next` is the
-- SQL twin of `nextOccurrenceAfter` in packages/core/src/group/recurring.ts and
-- packages/db/test/group-recurring.test.ts pins the same cases against it.

CREATE TABLE public.group_recurring_expenses (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    created_by uuid NOT NULL,
    description text NOT NULL,
    category text,
    currency character(3) NOT NULL,
    amount bigint NOT NULL,
    split_type text NOT NULL,
    split_params jsonb NOT NULL,
    payers jsonb NOT NULL,
    shares jsonb NOT NULL,
    notes text,
    cadence text NOT NULL,
    "interval" integer DEFAULT 1 NOT NULL,
    second_day integer,
    anchor_date date NOT NULL,
    next_date date NOT NULL,
    end_date date,
    status text DEFAULT 'active' NOT NULL,
    last_generated_on date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    CONSTRAINT group_recurring_expenses_pkey PRIMARY KEY (id),
    CONSTRAINT group_recurring_expenses_amount_positive CHECK ((amount > 0)),
    CONSTRAINT group_recurring_expenses_description_present CHECK ((btrim(description) <> '')),
    CONSTRAINT group_recurring_expenses_cadence_known CHECK ((cadence = ANY (ARRAY['weekly', 'semimonthly', 'monthly', 'yearly']))),
    CONSTRAINT group_recurring_expenses_interval_sane CHECK (("interval" BETWEEN 1 AND 60)),
    CONSTRAINT group_recurring_expenses_second_day_sane CHECK (((second_day IS NULL) OR (second_day BETWEEN 1 AND 31))),
    CONSTRAINT group_recurring_expenses_status_known CHECK ((status = ANY (ARRAY['active', 'paused', 'stopped']))),
    CONSTRAINT group_recurring_expenses_end_after_anchor CHECK (((end_date IS NULL) OR (end_date >= anchor_date)))
);

COMMENT ON TABLE public.group_recurring_expenses IS 'A repeating group expense (a flat''s monthly rent). The server generator posts one real expense per occurrence through waves_apply_expense, idempotently.';

ALTER TABLE ONLY public.group_recurring_expenses
    ADD CONSTRAINT group_recurring_expenses_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_recurring_expenses
    ADD CONSTRAINT group_recurring_expenses_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- The sync pull's index, and the generator's: "active rules that are due".
CREATE INDEX group_recurring_expenses_group_id_updated_seq_idx
  ON public.group_recurring_expenses USING btree (group_id, updated_seq);
CREATE INDEX group_recurring_expenses_due_idx
  ON public.group_recurring_expenses USING btree (next_date) WHERE (status = 'active');

CREATE TRIGGER group_recurring_expenses_stamp_seq BEFORE INSERT OR UPDATE ON public.group_recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();

-- Everyone in the group reads the rules (it is shared money); every write goes
-- through the functions below, which check membership themselves.
ALTER TABLE public.group_recurring_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_recurring_expenses_select ON public.group_recurring_expenses
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

REVOKE ALL ON TABLE public.group_recurring_expenses FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.group_recurring_expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_recurring_expenses TO service_role;

-- ───────────────────────────────────────────────────────────── dates ──

-- The first occurrence strictly after p_after (the anchor if p_after is before
-- it). Mirrors nextOccurrenceAfter in @waves/core.
CREATE FUNCTION public.waves_recurring_next(
  p_cadence text, p_interval integer, p_second_day integer, p_anchor date, p_after date
) RETURNS date
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_step    integer := GREATEST(COALESCE(p_interval, 1), 1);
  v_months  integer;
  v_unit    integer;
  v_k       integer;
  v_cand    date;
  v_y       integer;
  v_m       integer;
  v_d       integer;
  v_lo      integer;
  v_hi      integer;
  v_dim     integer;
BEGIN
  IF p_after < p_anchor THEN
    RETURN p_anchor;
  END IF;

  IF p_cadence = 'semimonthly' THEN
    IF p_second_day IS NULL THEN
      v_months := 1;
    ELSE
      v_y := extract(year FROM p_after)::int;
      v_m := extract(month FROM p_after)::int;
      v_d := extract(day FROM p_after)::int;
      v_lo := LEAST(extract(day FROM p_anchor)::int, p_second_day);
      v_hi := GREATEST(extract(day FROM p_anchor)::int, p_second_day);
      v_dim := extract(day FROM (make_date(v_y, v_m, 1) + interval '1 month - 1 day'))::int;
      IF v_d < LEAST(v_lo, v_dim) THEN RETURN make_date(v_y, v_m, LEAST(v_lo, v_dim)); END IF;
      IF v_d < LEAST(v_hi, v_dim) THEN RETURN make_date(v_y, v_m, LEAST(v_hi, v_dim)); END IF;
      v_m := v_m + 1;
      IF v_m > 12 THEN v_m := 1; v_y := v_y + 1; END IF;
      v_dim := extract(day FROM (make_date(v_y, v_m, 1) + interval '1 month - 1 day'))::int;
      RETURN make_date(v_y, v_m, LEAST(v_lo, v_dim));
    END IF;
    -- second day missing: behaves as a monthly step (as addToDate does)
    v_unit := 1;
    v_step := 1;
  END IF;

  IF p_cadence = 'weekly' THEN
    v_k := GREATEST(floor((p_after - p_anchor)::numeric / (7 * v_step))::int - 1, 0);
    LOOP
      v_cand := p_anchor + (7 * v_step * v_k);
      EXIT WHEN v_cand > p_after;
      v_k := v_k + 1;
    END LOOP;
    RETURN v_cand;
  END IF;

  -- monthly / yearly (and the degenerate semimonthly): a step in months
  v_unit := CASE WHEN p_cadence = 'yearly' THEN 12 * v_step ELSE v_step END;
  v_months := (extract(year FROM p_after)::int * 12 + extract(month FROM p_after)::int)
            - (extract(year FROM p_anchor)::int * 12 + extract(month FROM p_anchor)::int);
  v_k := GREATEST(floor(v_months::numeric / v_unit)::int - 1, 0);
  LOOP
    v_m := (extract(year FROM p_anchor)::int * 12 + extract(month FROM p_anchor)::int - 1) + v_unit * v_k;
    v_y := v_m / 12;
    v_m := v_m % 12 + 1;
    v_dim := extract(day FROM (make_date(v_y, v_m, 1) + interval '1 month - 1 day'))::int;
    v_cand := make_date(v_y, v_m, LEAST(extract(day FROM p_anchor)::int, v_dim));
    EXIT WHEN v_cand > p_after;
    v_k := v_k + 1;
  END LOOP;
  RETURN v_cand;
END
$$;

-- The first occurrence on or after p_on. Used when a rule resumes or its
-- schedule is edited: time spent paused is never back-paid.
CREATE FUNCTION public.waves_recurring_first_on_or_after(
  p_cadence text, p_interval integer, p_second_day integer, p_anchor date, p_on date
) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE WHEN p_on <= p_anchor THEN p_anchor
              ELSE public.waves_recurring_next(p_cadence, p_interval, p_second_day, p_anchor, p_on - 1)
         END
$$;

-- A uuid derived from a rule and an occurrence date: the idempotency key.
CREATE FUNCTION public.waves_recurring_derived_id(p_kind text, p_rule_id uuid, p_date date) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT md5('waves.recurring.' || p_kind || ':' || p_rule_id::text || ':' || p_date::text)::uuid
$$;

-- ─────────────────────────────────────────────────────── write path ──

-- The expense a rule posts must add up and name only this group's members. The
-- same facts waves_apply_expense re-checks at generation time, caught here when
-- the rule is written so a broken rule never reaches the schedule.
CREATE FUNCTION public.waves_assert_recurring_template(
  p_group_id uuid, p_amount bigint, p_payers jsonb, p_shares jsonb
) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_paid bigint;
  v_owed bigint;
  v_unknown int;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a repeating expense needs an amount' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(p_payers) IS DISTINCT FROM 'array' OR jsonb_typeof(p_shares) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payers) = 0 OR jsonb_array_length(p_shares) = 0 THEN
    RAISE EXCEPTION 'INVALID_TEMPLATE: payers and shares must be non-empty lists' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum((value ->> 'amount')::bigint), 0) INTO v_paid FROM jsonb_array_elements(p_payers);
  SELECT COALESCE(sum((value ->> 'amount')::bigint), 0) INTO v_owed FROM jsonb_array_elements(p_shares);
  IF v_paid <> p_amount OR v_owed <> p_amount THEN
    RAISE EXCEPTION 'TEMPLATE_MISMATCH: payers (%) and shares (%) must each add up to %', v_paid, v_owed, p_amount
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_unknown
  FROM (
    SELECT (value ->> 'memberId')::uuid AS member_id FROM jsonb_array_elements(p_payers)
    UNION
    SELECT (value ->> 'memberId')::uuid FROM jsonb_array_elements(p_shares)
  ) referenced
  WHERE NOT EXISTS (
    SELECT 1 FROM public.group_members gm
     WHERE gm.id = referenced.member_id AND gm.group_id = p_group_id
  );
  IF v_unknown > 0 THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: % member(s) are not in this group', v_unknown
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END
$$;

CREATE FUNCTION public.waves_create_group_recurring_expense(
  p_group_id uuid,
  p_id uuid,
  p_description text,
  p_category text,
  p_currency character,
  p_amount bigint,
  p_split_type text,
  p_split_params jsonb,
  p_payers jsonb,
  p_shares jsonb,
  p_notes text,
  p_cadence text,
  p_interval integer,
  p_second_day integer,
  p_anchor_date date,
  p_end_date date DEFAULT NULL,
  -- The first occurrence is the expense the person has just added by hand:
  -- start the rule at the one after it, so that date is not posted twice.
  p_skip_first boolean DEFAULT false
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_me uuid;
  v_id uuid;
  v_next date := p_anchor_date;
  v_cadence_second integer := CASE WHEN p_cadence = 'semimonthly' THEN p_second_day END;
BEGIN
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_me := public.waves_my_member_id(p_group_id);

  -- A replayed create (the offline queue retries) returns the same rule, but
  -- only for this group: an id is not a way to read or claim another group's.
  IF p_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.group_recurring_expenses WHERE id = p_id AND group_id = p_group_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  IF coalesce(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'INVALID_TITLE: a repeating expense needs a name' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.waves_assert_recurring_template(p_group_id, p_amount, p_payers, p_shares);

  IF p_skip_first THEN
    v_next := public.waves_recurring_next(p_cadence, GREATEST(COALESCE(p_interval, 1), 1),
                v_cadence_second, p_anchor_date, p_anchor_date);
  END IF;

  INSERT INTO public.group_recurring_expenses
    (id, group_id, created_by, description, category, currency, amount, split_type, split_params,
     payers, shares, notes, cadence, "interval", second_day, anchor_date, next_date, end_date,
     last_generated_on, status)
  VALUES
    (COALESCE(p_id, gen_random_uuid()), p_group_id, v_me, btrim(p_description), p_category,
     upper(p_currency), p_amount, p_split_type, p_split_params, p_payers, p_shares,
     NULLIF(btrim(p_notes), ''), p_cadence, GREATEST(COALESCE(p_interval, 1), 1),
     v_cadence_second,
     p_anchor_date, v_next, p_end_date,
     CASE WHEN p_skip_first THEN p_anchor_date END,
     CASE WHEN p_skip_first AND p_end_date IS NOT NULL AND v_next > p_end_date THEN 'stopped' ELSE 'active' END)
  RETURNING id INTO v_id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (p_group_id, v_me, 'recurring_created', 'recurring_expense', v_id,
          jsonb_build_object('description', btrim(p_description)));

  RETURN v_id;
END
$$;

-- One patch function for edit, pause, resume and stop: any live member may call
-- it (a flat's rent belongs to the flat). A key that is absent keeps the value;
-- `end_date` set to JSON null clears it. A stopped rule is final.
CREATE FUNCTION public.waves_update_group_recurring_expense(p_id uuid, p_patch jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  r              public.group_recurring_expenses%ROWTYPE;
  v_today        date := (now() AT TIME ZONE 'UTC')::date;
  v_status       text;
  v_cadence      text;
  v_interval     integer;
  v_second_day   integer;
  v_anchor       date;
  v_end          date;
  v_next         date;
  v_amount       bigint;
  v_payers       jsonb;
  v_shares       jsonb;
  v_schedule_changed boolean;
  v_actor        uuid;
BEGIN
  SELECT * INTO r FROM public.group_recurring_expenses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(r.group_id) THEN
    -- the same answer for "no such rule" and "not yours to see"
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.status = 'stopped' THEN
    RAISE EXCEPTION 'RULE_STOPPED: a stopped repeating expense cannot be changed' USING ERRCODE = 'check_violation';
  END IF;

  v_status := COALESCE(p_patch ->> 'status', r.status);
  IF v_status NOT IN ('active', 'paused', 'stopped') THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', v_status USING ERRCODE = 'check_violation';
  END IF;

  v_cadence    := COALESCE(p_patch ->> 'cadence', r.cadence);
  v_interval   := COALESCE((p_patch ->> 'interval')::int, r.interval);
  v_second_day := CASE WHEN p_patch ? 'second_day' THEN (p_patch ->> 'second_day')::int ELSE r.second_day END;
  v_anchor     := COALESCE((p_patch ->> 'anchor_date')::date, r.anchor_date);
  v_end        := CASE WHEN p_patch ? 'end_date' THEN (p_patch ->> 'end_date')::date ELSE r.end_date END;
  IF v_cadence <> 'semimonthly' THEN v_second_day := NULL; END IF;

  v_amount := COALESCE((p_patch ->> 'amount')::bigint, r.amount);
  v_payers := COALESCE(p_patch -> 'payers', r.payers);
  v_shares := COALESCE(p_patch -> 'shares', r.shares);
  IF p_patch ? 'amount' OR p_patch ? 'payers' OR p_patch ? 'shares' THEN
    PERFORM public.waves_assert_recurring_template(r.group_id, v_amount, v_payers, v_shares);
  END IF;
  IF p_patch ? 'description' AND coalesce(btrim(p_patch ->> 'description'), '') = '' THEN
    RAISE EXCEPTION 'INVALID_TITLE: a repeating expense needs a name' USING ERRCODE = 'check_violation';
  END IF;

  v_schedule_changed := (v_cadence, v_interval, v_second_day, v_anchor)
                        IS DISTINCT FROM (r.cadence, r.interval, r.second_day, r.anchor_date);

  v_next := r.next_date;
  IF v_schedule_changed THEN
    -- A new schedule starts from today: editing never back-pays old dates.
    v_next := public.waves_recurring_first_on_or_after(v_cadence, v_interval, v_second_day, v_anchor,
                GREATEST(v_anchor, v_today));
  ELSIF v_status = 'active' AND r.status = 'paused' AND v_next < v_today THEN
    v_next := public.waves_recurring_first_on_or_after(v_cadence, v_interval, v_second_day, v_anchor, v_today);
  END IF;

  IF v_end IS NOT NULL AND v_end < v_anchor THEN
    RAISE EXCEPTION 'INVALID_END: the end date is before the first one' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.group_recurring_expenses SET
    description = COALESCE(NULLIF(btrim(p_patch ->> 'description'), ''), description),
    category    = CASE WHEN p_patch ? 'category' THEN p_patch ->> 'category' ELSE category END,
    currency    = COALESCE(upper(p_patch ->> 'currency'), currency),
    amount      = v_amount,
    split_type  = COALESCE(p_patch ->> 'split_type', split_type),
    split_params = COALESCE(p_patch -> 'split_params', split_params),
    payers      = v_payers,
    shares      = v_shares,
    notes       = CASE WHEN p_patch ? 'notes' THEN NULLIF(btrim(p_patch ->> 'notes'), '') ELSE notes END,
    cadence     = v_cadence,
    "interval"  = v_interval,
    second_day  = v_second_day,
    anchor_date = v_anchor,
    next_date   = v_next,
    end_date    = v_end,
    status      = v_status,
    -- Whoever changes what the rule posts becomes the author of what it posts
    -- next: a member can edit the template, but never makes it speak for someone
    -- else. Pausing, resuming, stopping and rescheduling leave the author alone.
    created_by  = CASE WHEN p_patch ?| ARRAY['description','category','currency','amount','split_type',
                                              'split_params','payers','shares','notes']
                       THEN COALESCE(public.waves_my_member_id(r.group_id), created_by)
                       ELSE created_by END,
    updated_at  = now()
  WHERE id = p_id;

  -- The feed says who changed a shared rule. What changed is one of five verbs:
  -- edited (anything but the status), then paused / resumed / stopped. A patch
  -- that changes nothing writes nothing.
  v_actor := public.waves_my_member_id(r.group_id);
  IF p_patch ?| ARRAY['description','category','currency','amount','split_type','split_params',
                      'payers','shares','notes','cadence','interval','second_day','anchor_date','end_date']
     OR v_schedule_changed THEN
    INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (r.group_id, v_actor, 'recurring_edited', 'recurring_expense', p_id,
            jsonb_build_object('description', COALESCE(NULLIF(btrim(p_patch ->> 'description'), ''), r.description)));
  END IF;
  IF v_status IS DISTINCT FROM r.status THEN
    INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES (r.group_id, v_actor,
            CASE v_status WHEN 'paused' THEN 'recurring_paused'
                          WHEN 'stopped' THEN 'recurring_stopped'
                          ELSE 'recurring_resumed' END,
            'recurring_expense', p_id,
            jsonb_build_object('description', COALESCE(NULLIF(btrim(p_patch ->> 'description'), ''), r.description)));
  END IF;
END
$$;

-- ──────────────────────────────────────────── the one narrow exception ──
--
-- `waves_assert_expense_caller` makes a signed-in caller write only as
-- themselves. The generator writes as the rule's author, usually not whoever's
-- phone triggered the catch-up, so the generator records "this transaction is
-- posting as member M" in a table nobody but SECURITY DEFINER code can touch
-- (no grants, RLS on), keyed by the transaction id, and the check stands aside
-- for exactly that member in exactly that transaction. Deliberately not a
-- session setting: a setting is something any caller able to run SQL could set,
-- a row in a table with no grants is not.
CREATE TABLE public.waves_recurring_authoring (
    txid bigint NOT NULL,
    member_id uuid NOT NULL,
    PRIMARY KEY (txid, member_id)
);
ALTER TABLE public.waves_recurring_authoring ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.waves_recurring_authoring FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.waves_assert_expense_caller(p_group_id uuid, p_author_member_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_me      uuid;
  v_profile uuid := public.waves_current_profile_id();
BEGIN
  IF v_profile IS NULL THEN
    RETURN;
  END IF;

  -- The recurring-expense generator, posting a rule's own occurrence as the
  -- member who owns the rule (see waves_generate_recurring_expenses).
  IF p_author_member_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.waves_recurring_authoring ra
        WHERE ra.txid = txid_current() AND ra.member_id = p_author_member_id) THEN
    RETURN;
  END IF;

  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- An expense records who wrote it, and the version rows are append-only, so
  -- a wrong name on one is permanent. A client may only ever write as itself.
  v_me := public.waves_my_member_id_for(p_group_id, v_profile);
  IF p_author_member_id IS NOT NULL AND p_author_member_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'NOT_THE_AUTHOR: an expense is recorded as written by whoever wrote it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- Same caller model as before (authenticated + service_role), restated because
-- the grants audit wants it in the migration that redefines the function.
REVOKE ALL ON FUNCTION public.waves_assert_expense_caller(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_assert_expense_caller(uuid, uuid) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────── generator ──

CREATE FUNCTION public.waves_generate_recurring_expenses(
  p_now timestamptz DEFAULT now(),
  p_group_id uuid DEFAULT NULL,
  p_max_per_rule integer DEFAULT 12
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_today     date := (p_now AT TIME ZONE 'UTC')::date;
  r           record;
  v_next      date;
  v_prev      date;
  v_last      date;
  v_count     integer;
  v_result    jsonb;
  v_generated integer := 0;
  v_replayed  integer := 0;
  v_failed    integer := 0;
BEGIN
  FOR r IN
    SELECT x.*
      FROM public.group_recurring_expenses x
      JOIN public.groups g ON g.id = x.group_id
     WHERE x.status = 'active'
       AND x.next_date <= v_today
       AND (p_group_id IS NULL OR x.group_id = p_group_id)
       AND g.deleted_at IS NULL
       AND g.archived_at IS NULL
     ORDER BY x.next_date, x.id
       -- Locked so two overlapping runs (cron + a phone) split the rules
       -- instead of both working the same one.
       FOR UPDATE OF x SKIP LOCKED
  LOOP
    -- Each rule in its own sub-transaction: one bad rule must not stop the rest.
    BEGIN
      -- An expense is recorded as written by someone; if that person has left the
      -- group the rule pauses rather than writing as a stranger.
      IF NOT EXISTS (
        SELECT 1 FROM public.group_members gm
         WHERE gm.id = r.created_by AND gm.group_id = r.group_id AND gm.left_at IS NULL
      ) THEN
        UPDATE public.group_recurring_expenses SET status = 'paused', updated_at = now() WHERE id = r.id;
        CONTINUE;
      END IF;

      v_next := r.next_date;
      v_last := NULL;
      v_count := 0;
      WHILE v_next <= v_today
        AND v_count < GREATEST(p_max_per_rule, 1)
        AND (r.end_date IS NULL OR v_next <= r.end_date)
      LOOP
        INSERT INTO public.waves_recurring_authoring (txid, member_id)
          VALUES (txid_current(), r.created_by) ON CONFLICT DO NOTHING;
        v_result := public.waves_apply_expense(
          p_group_id           => r.group_id,
          p_expense_id         => public.waves_recurring_derived_id('expense', r.id, v_next),
          p_author_member_id   => r.created_by,
          p_description        => r.description,
          p_category           => r.category,
          p_expense_date       => v_next,
          p_currency           => r.currency,
          p_amount             => r.amount,
          p_split_type         => r.split_type,
          p_split_params       => r.split_params,
          p_payers             => r.payers,
          p_shares             => r.shares,
          p_client_mutation_id => public.waves_recurring_derived_id('mutation', r.id, v_next),
          p_notes              => r.notes
        );
        DELETE FROM public.waves_recurring_authoring WHERE txid = txid_current();
        IF COALESCE((v_result ->> 'replayed')::boolean, false) THEN
          v_replayed := v_replayed + 1;
        ELSE
          v_generated := v_generated + 1;
        END IF;
        v_count := v_count + 1;
        v_last := v_next;
        v_prev := v_next;
        v_next := public.waves_recurring_next(r.cadence, r.interval, r.second_day, r.anchor_date, v_prev);
        EXIT WHEN v_next <= v_prev; -- cannot happen; never loop on a bad schedule
      END LOOP;

      UPDATE public.group_recurring_expenses SET
        next_date         = v_next,
        last_generated_on = COALESCE(v_last, last_generated_on),
        -- Past its end date the rule is over; the list shows it as ended.
        status            = CASE WHEN r.end_date IS NOT NULL AND v_next > r.end_date THEN 'stopped' ELSE status END,
        updated_at        = now()
      WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'waves_generate_recurring_expenses: rule % failed: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('generated', v_generated, 'replayed', v_replayed, 'failed', v_failed);
END
$$;

-- The caller's own catch-up: the same generator, for the groups the caller is a
-- live member of. A phone calls it on open, so a rule posts even where the
-- schedule is not enabled (local, self-host) or has not run yet today.
CREATE FUNCTION public.waves_generate_my_recurring_expenses(p_today date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile    uuid := public.waves_current_profile_id();
  -- Never later than tomorrow in UTC: a phone's "today" may be ahead of UTC by
  -- up to 14 hours, and not a day further.
  v_now        timestamptz := LEAST(
                   COALESCE((p_today::text || ' 00:00:00+00')::timestamptz, now()),
                   now() + interval '1 day');
  g            record;
  v_one        jsonb;
  v_generated  integer := 0;
  v_replayed   integer := 0;
  v_failed     integer := 0;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR g IN
    SELECT DISTINCT gm.group_id
      FROM public.group_members gm
      JOIN public.group_recurring_expenses x ON x.group_id = gm.group_id
     WHERE gm.profile_id = v_profile AND gm.left_at IS NULL
       AND x.status = 'active' AND x.next_date <= (v_now AT TIME ZONE 'UTC')::date
  LOOP
    v_one := public.waves_generate_recurring_expenses(v_now, g.group_id);
    v_generated := v_generated + (v_one ->> 'generated')::int;
    v_replayed  := v_replayed  + (v_one ->> 'replayed')::int;
    v_failed    := v_failed    + (v_one ->> 'failed')::int;
  END LOOP;

  RETURN jsonb_build_object('generated', v_generated, 'replayed', v_replayed, 'failed', v_failed);
END
$$;

-- ─────────────────────────────────────────────────────────── grants ──
-- Service role / cron: the generator. Signed-in members: the rule writes and
-- their own catch-up. Nothing here is reachable by anon or PUBLIC.

REVOKE ALL ON FUNCTION public.waves_recurring_next(text, integer, integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_recurring_next(text, integer, integer, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_recurring_first_on_or_after(text, integer, integer, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_recurring_first_on_or_after(text, integer, integer, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_recurring_derived_id(text, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_recurring_derived_id(text, uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.waves_assert_recurring_template(uuid, bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_assert_recurring_template(uuid, bigint, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.waves_create_group_recurring_expense(uuid, uuid, text, text, character, bigint, text, jsonb, jsonb, jsonb, text, text, integer, integer, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_create_group_recurring_expense(uuid, uuid, text, text, character, bigint, text, jsonb, jsonb, jsonb, text, text, integer, integer, date, date, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_update_group_recurring_expense(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_update_group_recurring_expense(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.waves_generate_my_recurring_expenses(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_generate_my_recurring_expenses(date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.waves_generate_recurring_expenses(timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_generate_recurring_expenses(timestamptz, uuid, integer) TO service_role;

-- ─────────────────────────────────────────────────────────── schedule ──
-- Hourly, five past: an occurrence appears within the hour of its UTC date.
-- Guarded, because a local stack has no pg_cron and a migration that assumes
-- one cannot be run before it is deployed. Unscheduling first keeps the block
-- idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('waves-generate-recurring-expenses')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waves-generate-recurring-expenses');
    PERFORM cron.schedule(
      'waves-generate-recurring-expenses',
      '5 * * * *',
      $cron$SELECT public.waves_generate_recurring_expenses();$cron$
    );
  END IF;
END
$$;
