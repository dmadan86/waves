-- Income plans for a household group: what each member (a partner, a parent, a
-- grown child, with or without an account) plans to bring in each month, so the
-- household home can show "Income / Spent / Left". These are PLANS, not
-- expenses: nothing here touches expenses, shares or balances.
--
-- One group-visible table, written only through the SECURITY DEFINER functions
-- below (each checks membership itself), read by every live member through RLS
-- and synced like any other group child table (updated_seq + the group pull).
-- Deleting soft-deletes, so the pull carries the tombstone.
--
-- Deploy order: this migration, then the `sync` edge function (the new table and
-- the `group_income.set` / `group_income.delete` mutation kinds), then the app.
-- Old clients ignore tables and kinds they do not know.

CREATE TABLE public.group_income_plans (
    id uuid NOT NULL,
    group_id uuid NOT NULL,
    member_id uuid NOT NULL,
    label text NOT NULL,
    kind text DEFAULT 'salary' NOT NULL,
    amount_minor bigint NOT NULL,
    currency character(3) NOT NULL,
    day_of_month integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_seq bigint DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT group_income_plans_pkey PRIMARY KEY (id),
    CONSTRAINT group_income_plans_amount_positive CHECK ((amount_minor > 0)),
    CONSTRAINT group_income_plans_label_present CHECK ((btrim(label) <> '')),
    CONSTRAINT group_income_plans_kind_known CHECK ((kind = ANY (ARRAY['salary', 'pension', 'business', 'rent', 'other']))),
    CONSTRAINT group_income_plans_day_valid CHECK ((day_of_month BETWEEN 1 AND 28))
);

COMMENT ON TABLE public.group_income_plans IS 'What a household member plans to bring in each month. A plan, never an expense. Written only through waves_set_group_income / waves_delete_group_income.';

ALTER TABLE ONLY public.group_income_plans
    ADD CONSTRAINT group_income_plans_group_id_fkey FOREIGN KEY (group_id)
    REFERENCES public.groups(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_income_plans
    ADD CONSTRAINT group_income_plans_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.group_income_plans
    ADD CONSTRAINT group_income_plans_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.group_members(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX group_income_plans_group_id_updated_seq_idx ON public.group_income_plans USING btree (group_id, updated_seq);
CREATE INDEX group_income_plans_member_id_idx ON public.group_income_plans USING btree (member_id);
CREATE INDEX group_income_plans_created_by_idx ON public.group_income_plans USING btree (created_by);

CREATE TRIGGER group_income_plans_stamp_seq BEFORE INSERT OR UPDATE ON public.group_income_plans
  FOR EACH ROW EXECUTE FUNCTION public.waves_stamp_seq();

ALTER TABLE public.group_income_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_income_plans_select ON public.group_income_plans
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

REVOKE ALL ON TABLE public.group_income_plans FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.group_income_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_income_plans TO service_role;

-- ─────────────────────────────────────────────────────────── write path ──

-- Make or edit a plan (an upsert by the client-chosen id, so the offline
-- queue's retry is harmless). Any live member; a plan that belongs to another
-- group is never touched. The currency is fixed on first save.
CREATE FUNCTION public.waves_set_group_income(
  p_group_id uuid,
  p_id uuid,
  p_member_id uuid,
  p_label text,
  p_kind text,
  p_amount_minor bigint,
  p_currency character,
  p_day_of_month integer,
  p_active boolean
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_me uuid;
  v_existing record;
BEGIN
  IF NOT public.is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: you are not in that group' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_me := public.waves_my_member_id(p_group_id);
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ID: an income plan needs an id' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(btrim(p_label), '') = '' THEN
    RAISE EXCEPTION 'INVALID_NAME: an income plan needs a label' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('salary', 'pension', 'business', 'rent', 'other') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = 'check_violation';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: an amount is needed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_day_of_month IS NULL OR p_day_of_month < 1 OR p_day_of_month > 28 THEN
    RAISE EXCEPTION 'INVALID_DAY: pick a day from 1 to 28' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.group_members gm WHERE gm.id = p_member_id AND gm.group_id = p_group_id) THEN
    RAISE EXCEPTION 'UNKNOWN_MEMBER: that person is not in this group' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT group_id INTO v_existing FROM public.group_income_plans WHERE id = p_id;
  IF FOUND AND v_existing.group_id <> p_group_id THEN
    RAISE EXCEPTION 'NO_SUCH_PLAN' USING ERRCODE = 'no_data_found';
  END IF;

  IF FOUND THEN
    UPDATE public.group_income_plans SET
      member_id = p_member_id,
      label = btrim(p_label),
      kind = p_kind,
      amount_minor = p_amount_minor,
      day_of_month = p_day_of_month,
      active = COALESCE(p_active, true),
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    INSERT INTO public.group_income_plans
      (id, group_id, member_id, label, kind, amount_minor, currency, day_of_month, active, created_by)
    VALUES
      (p_id, p_group_id, p_member_id, btrim(p_label), p_kind, p_amount_minor, upper(p_currency),
       p_day_of_month, COALESCE(p_active, true), v_me);
  END IF;
  RETURN p_id;
END
$$;

-- Remove a plan (soft delete). Idempotent: a replay is a no-op.
CREATE FUNCTION public.waves_delete_group_income(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group uuid;
BEGIN
  SELECT group_id INTO v_group FROM public.group_income_plans WHERE id = p_id AND deleted_at IS NULL;
  IF v_group IS NULL OR NOT public.is_group_member(v_group) THEN
    RETURN;
  END IF;
  UPDATE public.group_income_plans SET deleted_at = now(), updated_at = now() WHERE id = p_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_set_group_income(uuid, uuid, uuid, text, text, bigint, character, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_set_group_income(uuid, uuid, uuid, text, text, bigint, character, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_set_group_income(uuid, uuid, uuid, text, text, bigint, character, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_set_group_income(uuid, uuid, uuid, text, text, bigint, character, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.waves_delete_group_income(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.waves_delete_group_income(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.waves_delete_group_income(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_delete_group_income(uuid) TO service_role;
