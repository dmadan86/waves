-- Household "Share it" mode: a group is either 'split' (track who paid and who
-- owes) or 'pool' (one pot, nobody owes anybody). Only an admin switches it.
-- Old apps never send the column and ignore it on read; existing groups stay
-- 'split'.
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS ledger_mode text NOT NULL DEFAULT 'split';
ALTER TABLE public.groups
  ADD CONSTRAINT groups_ledger_mode_check CHECK (ledger_mode IN ('split', 'pool'));

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
    'units',
    'ledger_mode'
  ];
  v_refused text;
BEGIN
  IF NEW.default_currency IS DISTINCT FROM OLD.default_currency
     AND (
       EXISTS (SELECT 1 FROM public.company_entries ce WHERE ce.group_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.expenses e WHERE e.group_id = NEW.id)
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
    PERFORM public.waves_check_group_units(NEW.id, NEW.units);
  END IF;

  -- ── new: only an admin switches Split / Share ───────────────────────────
  IF NEW.ledger_mode IS DISTINCT FROM OLD.ledger_mode
     AND NOT public.is_group_admin(NEW.id) THEN
    RAISE EXCEPTION 'NOT_AN_ADMIN: only an admin changes how the group handles money'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.waves_guard_group_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_guard_group_columns() TO service_role;
