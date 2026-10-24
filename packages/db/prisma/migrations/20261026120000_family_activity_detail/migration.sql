-- Enrich the families activity payload so the app can render specific titles
-- instead of only a count. Previously the trigger wrote
--   { field: 'families', from: <count_int>, to: <count_int> }
-- which was enough for "Added a family" / "Removed a family" etc., but not for
-- "Renamed Sharma family to Goa family" or "Moved Anoop to Family1".
--
-- The new shape is:
--   { field: 'families',
--     from: <groups.units jsonb — null when there were none>,
--     to:   <groups.units jsonb — null when there are none>,
--     fromCount: <int>,
--     toCount:   <int> }
--
-- `fromCount`/`toCount` are kept so older app builds (which only understood
-- the integer `from`/`to`) keep working after an upgrade: they read integers
-- and they get integers under `fromCount`/`toCount`. Newer builds detect an
-- object `from`/`to` and diff the full maps; a build that meets neither falls
-- back to the static "Changed the families" string.
--
-- Only the families branch is changed. All other branches are verbatim copies
-- of the function body in 20261025100000_group_units, which itself was a
-- verbatim copy from 20261024100000_group_changes_activity with the families
-- block added. No other branch is touched.
--
-- Deploy order: this migration first, then the app build that reads the new
-- payload shape. Do NOT apply to the database directly — the migration runner
-- handles that as part of the normal deploy sequence.

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

  -- ── families: full jsonb maps so the app can render specific titles ──────
  -- `from`/`to` are the raw `groups.units` objects (null when there are none).
  -- `fromCount`/`toCount` let older app builds keep their count-based wording.
  IF NEW.units IS DISTINCT FROM OLD.units THEN
    v_changes := v_changes || jsonb_build_object(
      'field',     'families',
      'from',      OLD.units,
      'to',        NEW.units,
      'fromCount', CASE WHEN jsonb_typeof(OLD.units) = 'object'
                        THEN (SELECT count(*) FROM jsonb_object_keys(OLD.units))::int
                        ELSE 0 END,
      'toCount',   CASE WHEN jsonb_typeof(NEW.units) = 'object'
                        THEN (SELECT count(*) FROM jsonb_object_keys(NEW.units))::int
                        ELSE 0 END);
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

-- Trigger function: same caller model as before (CREATE OR REPLACE keeps grants; stated for the CI guard).
REVOKE ALL ON FUNCTION public.waves_log_group_changes() FROM PUBLIC, anon;
