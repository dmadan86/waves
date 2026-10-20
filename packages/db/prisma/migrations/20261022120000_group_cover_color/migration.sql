-- A group's icon always sat on a tile whose colour the app chose. A member can
-- now pick that colour.
--
-- `groups.cover_color` is one palette KEY ('peach', 'mint', ...; the list is
-- `GROUP_COVER_COLORS` in @waves/core), never a hex, so dark mode can map the
-- same pick to a different tone. Nullable, no default: NULL is "the app's own
-- colour", which is exactly what every existing group looks like, so nothing
-- changes for anyone until somebody picks one.
--
-- The CHECK is only the *shape* of a key (lowercase letters), not the list, so
-- a new swatch is an app release rather than a migration; a client meeting a
-- key it does not know draws the default.
--
-- Same writers as `cover_emoji` (any member of the group, via /sync or a direct
-- PATCH): RLS on `groups` is untouched, only the column guard's allowlist grows.
-- Old clients never read or write the column, so they keep working unchanged.
-- Deploy order: this migration, then the `sync` edge function (allowlist), then
-- the app.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS cover_color text;

DO $do$
BEGIN
  ALTER TABLE public.groups
    ADD CONSTRAINT groups_cover_color_shape
    CHECK (cover_color IS NULL OR cover_color ~ '^[a-z]{2,16}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$do$;

COMMENT ON COLUMN public.groups.cover_color IS
  'Palette key (lowercase letters) for the tile behind the group icon; NULL is the app default. Member-writable like cover_emoji.';

-- Verbatim from 20261009120000_settle_in_group_currency, with 'cover_color'
-- added to the allowlist. Kept in step with `GROUP_UPDATABLE_FIELDS` in
-- supabase/functions/sync/index.ts.
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
    'cover_color'
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
