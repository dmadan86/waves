-- Families inside a group (docs: plan "Families / units inside a group").
--
-- `groups.units` is the organiser's grouping of members into families:
--   { "<unitId>": { "name": "Sharma family", "members": [memberId…], "head": memberId } }
-- Group-visible like `category_budgets`; the shape is validated at the /sync
-- boundary (names 1..24, at most 50 families, a member in at most one, every
-- id a member of this group, the head one of its members). The ledger never
-- reads it: a bill split by family snapshots its own composition in
-- `split_params` under the new `units` split kind, so history is untouched
-- when somebody later moves family, and a family's balance is just the sum of
-- its members' — no new table, no new RPC, no balance column.
--
-- Only an admin may change the families (the tour-operator case). That is
-- enforced here in the column guard rather than only in /sync, because the
-- app can also PATCH `groups` directly through PostgREST.
--
-- Deploy order: this migration, then the `sync` edge function (allowlist +
-- validation, rebuilt core bundle with the `units` kind), then the app. The
-- `group_units` flag gates only the app's entry points and ships OFF.

ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS units jsonb;

COMMENT ON COLUMN public.groups.units IS
  'Families inside the group: { "<unitId>": { name, members: [member_id…], head? } }. NULL is none. Admin-written via group.update; validated in /sync.';

-- The split kind a by-family bill is stored under. `waves_apply_expense` casts
-- `p_split_type::"SplitType"`, so the enum has to carry it. Added with
-- IF NOT EXISTS so a re-run is a no-op; nothing in this file uses the value.
ALTER TYPE public."SplitType" ADD VALUE IF NOT EXISTS 'units';

-- Verbatim from 20261022120000_group_cover_color, with 'units' added to the
-- allowlist and an admin gate on it. Kept in step with `GROUP_UPDATABLE_FIELDS`
-- in supabase/functions/sync/index.ts.
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
    'custom_tag',
    'cover_color',
    'units'
  ];
  v_refused text;
BEGIN
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

  -- ── new: only an admin arranges the families ────────────────────────────
  IF NEW.units IS DISTINCT FROM OLD.units THEN
    IF NOT public.is_group_admin(NEW.id) THEN
      RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes the families'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.units IS NOT NULL
       AND (jsonb_typeof(NEW.units) <> 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(NEW.units)) > 50) THEN
      RAISE EXCEPTION 'INVALID_UNITS: families are an object of at most 50 entries'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

-- The activity feed hears about a families change the way it hears about a
-- rename: one `group_updated` row with `field = 'families'`. Verbatim from
-- 20261024100000_group_changes_activity with that one block added.
CREATE OR REPLACE FUNCTION public.waves_log_group_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_actor   uuid;
  v_old_fx  jsonb := COALESCE(OLD.fx_rates, '{}'::jsonb);
  v_new_fx  jsonb := COALESCE(NEW.fx_rates, '{}'::jsonb);
  v_code    text;
  v_changes jsonb[] := ARRAY[]::jsonb[];
  v_change  jsonb;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_actor := public.waves_my_member_id(NEW.id);

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    v_changes := v_changes || jsonb_build_object('field', 'name', 'from', OLD.name, 'to', NEW.name);
  END IF;

  IF NEW.description IS DISTINCT FROM OLD.description THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'description', 'from', OLD.description, 'to', NEW.description);
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'type', 'from', OLD.type::text, 'to', NEW.type::text);
  END IF;

  IF NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'dates',
      'from', jsonb_build_object('start', OLD.start_date, 'end', OLD.end_date),
      'to',   jsonb_build_object('start', NEW.start_date, 'end', NEW.end_date));
  END IF;

  IF NEW.custom_tag IS DISTINCT FROM OLD.custom_tag THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'tag', 'from', OLD.custom_tag, 'to', NEW.custom_tag);
  END IF;

  IF NEW.default_currency IS DISTINCT FROM OLD.default_currency THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'currency', 'from', OLD.default_currency, 'to', NEW.default_currency);
  END IF;

  IF NEW.convert_to_group_currency IS DISTINCT FROM OLD.convert_to_group_currency THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'convert',
      'from', OLD.convert_to_group_currency, 'to', NEW.convert_to_group_currency,
      'currency', NEW.default_currency);
  END IF;

  IF NEW.cover_emoji IS DISTINCT FROM OLD.cover_emoji
     OR NEW.photo_path IS DISTINCT FROM OLD.photo_path
     OR NEW.cover_color IS DISTINCT FROM OLD.cover_color THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'cover',
      'from', jsonb_build_object(
        'emoji', OLD.cover_emoji, 'color', OLD.cover_color, 'photo', OLD.photo_path IS NOT NULL),
      'to', jsonb_build_object(
        'emoji', NEW.cover_emoji, 'color', NEW.cover_color, 'photo', NEW.photo_path IS NOT NULL));
  END IF;

  IF v_new_fx IS DISTINCT FROM v_old_fx THEN
    FOR v_code IN
      SELECT DISTINCT k FROM (
        SELECT jsonb_object_keys(v_old_fx) AS k
        UNION
        SELECT jsonb_object_keys(v_new_fx)
      ) keys ORDER BY k
    LOOP
      IF NOT (v_old_fx ? v_code) THEN
        v_changes := v_changes || jsonb_build_object(
          'field', 'fx', 'change', 'added', 'currency', v_code,
          'to', jsonb_build_object('num', v_new_fx -> v_code ->> 'num', 'den', v_new_fx -> v_code ->> 'den'));
      ELSIF NOT (v_new_fx ? v_code) THEN
        v_changes := v_changes || jsonb_build_object(
          'field', 'fx', 'change', 'removed', 'currency', v_code,
          'from', jsonb_build_object('num', v_old_fx -> v_code ->> 'num', 'den', v_old_fx -> v_code ->> 'den'));
      ELSIF (v_old_fx -> v_code ->> 'num') IS DISTINCT FROM (v_new_fx -> v_code ->> 'num')
         OR (v_old_fx -> v_code ->> 'den') IS DISTINCT FROM (v_new_fx -> v_code ->> 'den') THEN
        v_changes := v_changes || jsonb_build_object(
          'field', 'fx', 'change', 'rate', 'currency', v_code,
          'from', jsonb_build_object('num', v_old_fx -> v_code ->> 'num', 'den', v_old_fx -> v_code ->> 'den'),
          'to',   jsonb_build_object('num', v_new_fx -> v_code ->> 'num', 'den', v_new_fx -> v_code ->> 'den'));
      END IF;
    END LOOP;
  END IF;

  IF (NEW.archived_at IS NOT NULL) IS DISTINCT FROM (OLD.archived_at IS NOT NULL)
     AND v_actor IS NOT NULL THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'archived', 'from', OLD.archived_at IS NOT NULL, 'to', NEW.archived_at IS NOT NULL);
  END IF;

  IF NEW.simplify_debts IS DISTINCT FROM OLD.simplify_debts THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'simplify', 'from', OLD.simplify_debts, 'to', NEW.simplify_debts);
  END IF;

  IF NEW.budget_minor IS DISTINCT FROM OLD.budget_minor
     OR NEW.budget_currency IS DISTINCT FROM OLD.budget_currency THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'budget',
      'from', CASE WHEN OLD.budget_minor IS NULL THEN NULL ELSE
        jsonb_build_object('amount', OLD.budget_minor::text, 'currency', OLD.budget_currency) END,
      'to', CASE WHEN NEW.budget_minor IS NULL THEN NULL ELSE
        jsonb_build_object('amount', NEW.budget_minor::text, 'currency', NEW.budget_currency) END);
  END IF;

  IF NEW.trip_stops IS DISTINCT FROM OLD.trip_stops THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'stops',
      'from', COALESCE(jsonb_array_length(OLD.trip_stops), 0),
      'to',   COALESCE(jsonb_array_length(NEW.trip_stops), 0));
  END IF;

  -- ── new: the families, as how many there are now ────────────────────────
  IF NEW.units IS DISTINCT FROM OLD.units THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'families',
      'from', CASE WHEN jsonb_typeof(OLD.units) = 'object'
                   THEN (SELECT count(*) FROM jsonb_object_keys(OLD.units)) ELSE 0 END,
      'to',   CASE WHEN jsonb_typeof(NEW.units) = 'object'
                   THEN (SELECT count(*) FROM jsonb_object_keys(NEW.units)) ELSE 0 END);
  END IF;

  FOREACH v_change IN ARRAY v_changes LOOP
    INSERT INTO public.activity_log
      (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES
      (NEW.id, v_actor, 'group_updated', 'group', NEW.id, v_change);
  END LOOP;

  RETURN NEW;
END
$$;

-- The flag behind the app's entry points (settings row, add-expense pill,
-- balances lens). Off for everyone until switched on; the server accepts
-- `units` bills and maps from day one regardless.
INSERT INTO public.feature_flags (key, description, enabled, rollout_percent)
VALUES (
  'group_units',
  'Families inside a group: the Families screen in group settings, the People/Families split choice and the Families lens on Balances. UI only; the server accepts units regardless.',
  false,
  0
)
ON CONFLICT (key) DO NOTHING;
