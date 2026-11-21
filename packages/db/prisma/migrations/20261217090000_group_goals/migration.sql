-- Joint goals for a group: a couple or a family puts money aside together
-- toward one thing (a house, a trip, school fees). Works in ANY group, whether
-- the expenses are split or pooled.
--
-- Two group-visible tables, written only through the SECURITY DEFINER functions
-- below (every one checks membership itself), read by every live member through
-- RLS and synced like any other group child table (updated_seq + the group pull).
--
--   * group_goals: the goal. `monthly_plan` is {memberId: minor-units-as-number}
--     — each person's monthly share; optional. `for_member_id` is "this one is
--     for X" (a gift, a person's fees); optional.
--   * group_goal_contributions: money put aside, signed (negative = taken out).
--     Voiding soft-deletes, so the history stays honest and the pull carries
--     the tombstone. The total put aside never goes below zero.
--
-- Nothing here counts returns or interest; the app says "put aside", never
-- "saved" or "invested".
--
-- Deploy order: this migration, then the `sync` edge function (new tables and
-- the four `group_goal*` mutation kinds), then the app. Old clients ignore
-- tables and kinds they do not know, so they keep working unchanged.

CREATE TABLE public.group_goals (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    name text NOT NULL,
    emoji text,
    target_minor bigint NOT NULL,
    currency character(3) NOT NULL,
    target_date date,
    for_member_id uuid,
    monthly_plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT group_goals_pkey PRIMARY KEY (id),
    CONSTRAINT group_goals_target_positive CHECK ((target_minor > 0)),
    CONSTRAINT group_goals_name_present CHECK ((btrim(name) <> '')),
    CONSTRAINT group_goals_status_known CHECK ((status = ANY (ARRAY['active', 'done', 'archived']))),
    CONSTRAINT group_goals_plan_object CHECK ((jsonb_typeof(monthly_plan) = 'object'))
);

COMMENT ON TABLE public.group_goals IS 'A goal a group puts money aside for together. Written only through waves_set_group_goal / waves_archive_group_goal.';

ALTER TABLE ONLY public.group_goals
    ADD CONSTRAINT group_goals_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_goals
    ADD CONSTRAINT group_goals_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_goals
    ADD CONSTRAINT group_goals_for_member_id_fkey FOREIGN KEY (for_member_id)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX group_goals_group_id_updated_seq_idx ON public.group_goals USING btree (group_id, updated_seq);
CREATE INDEX group_goals_created_by_idx ON public.group_goals USING btree (created_by);
CREATE INDEX group_goals_for_member_id_idx ON public.group_goals USING btree (for_member_id);

CREATE TRIGGER group_goals_stamp_seq BEFORE INSERT OR UPDATE ON public.group_goals
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();

CREATE TABLE public.group_goal_contributions (
    id uuid NOT NULL,
    goal_id uuid NOT NULL,
    group_id uuid NOT NULL,
    member_id uuid NOT NULL,
    amount_minor bigint NOT NULL,
    date date NOT NULL,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT group_goal_contributions_pkey PRIMARY KEY (id),
    CONSTRAINT group_goal_contributions_amount_nonzero CHECK ((amount_minor <> 0))
);

COMMENT ON TABLE public.group_goal_contributions IS 'Money put aside toward a goal; negative = taken out. Voiding sets deleted_at. Written only through waves_add_goal_contribution / waves_void_goal_contribution.';

ALTER TABLE ONLY public.group_goal_contributions
    ADD CONSTRAINT group_goal_contributions_goal_id_fkey FOREIGN KEY (goal_id)
    REFERENCES public.group_goals(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_goal_contributions
    ADD CONSTRAINT group_goal_contributions_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_goal_contributions
    ADD CONSTRAINT group_goal_contributions_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_goal_contributions
    ADD CONSTRAINT group_goal_contributions_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX group_goal_contributions_group_id_updated_seq_idx
  ON public.group_goal_contributions USING btree (group_id, updated_seq);
CREATE INDEX group_goal_contributions_goal_id_idx ON public.group_goal_contributions USING btree (goal_id);
CREATE INDEX group_goal_contributions_member_id_idx ON public.group_goal_contributions USING btree (member_id);
CREATE INDEX group_goal_contributions_created_by_idx ON public.group_goal_contributions USING btree (created_by);

CREATE TRIGGER group_goal_contributions_stamp_seq BEFORE INSERT OR UPDATE ON public.group_goal_contributions
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();

-- Everyone in the group reads; every write goes through the functions below.
ALTER TABLE public.group_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_goal_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_goals_select ON public.group_goals
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));
CREATE POLICY group_goal_contributions_select ON public.group_goal_contributions
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

REVOKE ALL ON TABLE public.group_goals FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.group_goal_contributions FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.group_goals TO authenticated;
GRANT SELECT ON TABLE public.group_goal_contributions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_goals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_goal_contributions TO service_role;

-- ─────────────────────────────────────────────────────────── write path ──

-- Make or edit a goal (one function, upsert by the client-chosen id, so the
-- offline queue's retry is harmless). Any live member; a goal that belongs to
-- another group is never touched.
CREATE FUNCTION public.waves_set_group_goal(
  p_group_id uuid,
  p_id uuid,
  p_name text,
  p_emoji text,
  p_target_minor bigint,
  p_currency character,
  p_target_date date,
  p_for_member_id uuid,
  p_monthly_plan jsonb
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_me uuid;
  v_plan jsonb := COALESCE(p_monthly_plan, '{}'::jsonb);
  v_entry record;
  v_existing record;
BEGIN
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_me := public.waves_my_member_id(p_group_id);
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ID: a goal needs an id' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'INVALID_NAME: a goal needs a name' USING ERRCODE = 'check_violation';
  END IF;
  IF p_target_minor IS NULL OR p_target_minor <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a goal needs an amount' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(v_plan) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PLAN: the monthly plan is a map of member to amount' USING ERRCODE = 'check_violation';
  END IF;
  IF p_for_member_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.group_members gm WHERE gm.id = p_for_member_id AND gm.group_id = p_group_id) THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: that person is not in this group' USING ERRCODE = 'foreign_key_violation';
  END IF;
  FOR v_entry IN SELECT key, value FROM jsonb_each(v_plan) LOOP
    IF jsonb_typeof(v_entry.value) <> 'number' OR (v_entry.value #>> '{}')::numeric < 0
       OR (v_entry.value #>> '{}')::numeric <> trunc((v_entry.value #>> '{}')::numeric) THEN
      RAISE EXCEPTION 'INVALID_PLAN: each monthly amount is a whole number' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM public.group_members gm
          WHERE gm.id::text = v_entry.key AND gm.group_id = p_group_id) THEN
      RAISE EXCEPTION 'UNKNOWN_MEMBER: that person is not in this group' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END LOOP;

  SELECT group_id, currency INTO v_existing FROM public.group_goals WHERE id = p_id;
  IF FOUND AND v_existing.group_id <> p_group_id THEN
    RAISE EXCEPTION 'NO_SUCH_GOAL' USING ERRCODE = 'no_data_found';
  END IF;

  IF FOUND THEN
    -- The currency is fixed once money may have been put aside.
    UPDATE public.group_goals SET
      name = btrim(p_name),
      emoji = NULLIF(btrim(p_emoji), ''),
      target_minor = p_target_minor,
      target_date = p_target_date,
      for_member_id = p_for_member_id,
      monthly_plan = v_plan,
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    INSERT INTO public.group_goals
      (id, group_id, name, emoji, target_minor, currency, target_date, for_member_id, monthly_plan, created_by)
    VALUES
      (p_id, p_group_id, btrim(p_name), NULLIF(btrim(p_emoji), ''), p_target_minor, upper(p_currency),
       p_target_date, p_for_member_id, v_plan, v_me);
  END IF;
  RETURN p_id;
END
$$;

-- Mark a goal done, archive it, or bring it back. Any live member.
CREATE FUNCTION public.waves_archive_group_goal(p_id uuid, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group uuid;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('active', 'done', 'archived') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'check_violation';
  END IF;
  SELECT group_id INTO v_group FROM public.group_goals WHERE id = p_id AND deleted_at IS NULL;
  IF v_group IS NULL OR NOT public.is_group_member(v_group) THEN
    RAISE EXCEPTION 'NO_SUCH_GOAL' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE public.group_goals SET status = p_status, updated_at = now()
   WHERE id = p_id AND status <> p_status;
END
$$;

-- Put money aside (positive) or take it out (negative). Idempotent by id.
-- Any live member may record for any member of the group (a partner pays in
-- for both); the total put aside never goes below zero.
CREATE FUNCTION public.waves_add_goal_contribution(
  p_goal_id uuid,
  p_id uuid,
  p_member_id uuid,
  p_amount_minor bigint,
  p_date date,
  p_note text DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_goal record;
  v_me uuid;
  v_total bigint;
  v_prior uuid;
BEGIN
  SELECT id, group_id, status INTO v_goal
    FROM public.group_goals WHERE id = p_goal_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.is_group_member(v_goal.group_id) THEN
    RAISE EXCEPTION 'NO_SUCH_GOAL' USING ERRCODE = 'no_data_found';
  END IF;
  v_me := public.waves_my_member_id(v_goal.group_id);

  IF p_id IS NOT NULL THEN
    SELECT id INTO v_prior FROM public.group_goal_contributions
     WHERE id = p_id AND goal_id = p_goal_id;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  IF v_goal.status = 'archived' THEN
    RAISE EXCEPTION 'GOAL_ARCHIVED: bring the goal back first' USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor = 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: an amount is needed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: a date is needed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.group_members gm WHERE gm.id = p_member_id AND gm.group_id = v_goal.group_id) THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: that person is not in this group' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_total
    FROM public.group_goal_contributions WHERE goal_id = p_goal_id AND deleted_at IS NULL;
  IF v_total + p_amount_minor < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_ASIDE: you cannot take out more than is put aside' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.group_goal_contributions
    (id, goal_id, group_id, member_id, amount_minor, date, note, created_by)
  VALUES
    (COALESCE(p_id, gen_random_uuid()), p_goal_id, v_goal.group_id, p_member_id, p_amount_minor, p_date,
     NULLIF(btrim(p_note), ''), v_me)
  RETURNING id INTO v_prior;
  RETURN v_prior;
END
$$;

-- Void a line (soft delete). Voiding a deposit that a later withdrawal relies
-- on would push the total below zero, so that is refused.
CREATE FUNCTION public.waves_void_goal_contribution(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row record;
  v_total bigint;
BEGIN
  SELECT c.goal_id, c.group_id, c.amount_minor INTO v_row
    FROM public.group_goal_contributions c WHERE c.id = p_id AND c.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_group_member(v_row.group_id) THEN
    RETURN; -- already voided, or not yours: a replay is a no-op
  END IF;
  PERFORM 1 FROM public.group_goals WHERE id = v_row.goal_id FOR UPDATE;
  SELECT COALESCE(sum(amount_minor), 0) INTO v_total
    FROM public.group_goal_contributions WHERE goal_id = v_row.goal_id AND deleted_at IS NULL;
  IF v_total - v_row.amount_minor < 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_ASIDE: a later withdrawal depends on this line' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.group_goal_contributions SET deleted_at = now() WHERE id = p_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_set_group_goal(uuid, uuid, text, text, bigint, character, date, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_set_group_goal(uuid, uuid, text, text, bigint, character, date, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_set_group_goal(uuid, uuid, text, text, bigint, character, date, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_set_group_goal(uuid, uuid, text, text, bigint, character, date, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.waves_archive_group_goal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_archive_group_goal(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_archive_group_goal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_archive_group_goal(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.waves_add_goal_contribution(uuid, uuid, uuid, bigint, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_add_goal_contribution(uuid, uuid, uuid, bigint, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_add_goal_contribution(uuid, uuid, uuid, bigint, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_add_goal_contribution(uuid, uuid, uuid, bigint, date, text) TO service_role;

REVOKE ALL ON FUNCTION public.waves_void_goal_contribution(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_void_goal_contribution(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_void_goal_contribution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_void_goal_contribution(uuid) TO service_role;
