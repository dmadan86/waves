-- Renaming a group, changing its type, setting the dates, adding a currency,
-- archiving it, adding or removing a person — none of it reached the activity
-- feed. `activity_log` only ever heard about bills, settlements, joins and the
-- group's own birth and death, so a member who opened Activity to find out why
-- the group was suddenly called something else found nothing.
--
-- There is no single door these changes go through. `/sync`'s `group.update`
-- is a plain PostgREST UPDATE on `groups` as the caller; the rates, the
-- convert flag, the budget and the itinerary each have their own RPC; a
-- member leaves by writing `left_at` themselves; an admin removes or promotes
-- somebody through two more RPCs. Logging from each of those is the same
-- change written six times and forgotten in the seventh, so instead two
-- AFTER triggers watch the rows: one on `groups`, one on `group_members`. They
-- diff OLD against NEW and write one `activity_log` row per thing a person
-- would call a change, and nothing for a bookkeeping write (`updated_seq`,
-- `updated_at`).
--
-- Group rows carry the verb `group_updated` with `payload.field` saying which
-- setting moved and `from`/`to` saying how: name, description, type, dates
-- (one row when either end moves), tag, currency, convert, cover (emoji,
-- photo or colour — one row), fx (a currency added, removed or re-rated),
-- archived, simplify, budget and stops. Member rows take their own verbs —
-- `member_added`, `member_removed`, `member_left`, `member_role_changed` —
-- because the feed draws people differently from settings.
--
-- The actor is whoever holds the JWT: `waves_my_member_id` for a group change,
-- and for a member change the caller's membership in that group (allowing the
-- row being retired, so somebody leaving is their own actor). A write with no
-- signed-in caller — the archive cron, an operator at the console — leaves
-- the actor NULL, which the feed reads as "Someone"; the one exception is the
-- archive itself, which `waves_auto_archive_stale_groups` already explains
-- with its own `auto_archived` row, so an actor-less archive is not written
-- twice.
--
-- Not logged on purpose: a join (`invite-accept` writes `joined`), a claim or
-- a merge (`claimed`/`merged` are written by their RPCs), the creator's own
-- membership (`created` covers it), a placeholder brought in by an import
-- batch (one `imported` row says it all), the retired duplicate row of a
-- claim approval, a delete (`group_deleted`), the join token, reminders, the
-- time zone and the country.
--
-- Both functions are SECURITY DEFINER: `authenticated` holds SELECT only on
-- `activity_log` (ADR-004), and a trigger runs as the user who caused it.
-- `waves_stamp_seq` stamps the new row's `updated_seq` the way it stamps every
-- other, so the row rides the existing `activity_log` pull into every member's
-- mirror; the stamp bumps the group's own `updated_seq`, which re-enters the
-- groups trigger with nothing but that column changed, and it returns.
--
-- Deploy order: this migration, then the app (which words the new rows; an
-- older app shows "Ravi group_updated group", its fallback for a verb it has
-- not met). No edge function changes.

-- ─────────────────────────────────────────────────── groups ──

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
  -- A deleted group is written about by waves_delete_group; its own delete,
  -- and anything written to the tombstone afterwards, is not a setting change.
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

  -- The cover is one thing to the reader whichever of its three columns moved.
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

  -- Rates: one row per currency that appeared, disappeared or changed value.
  -- `ts` and `source` are not a change anyone needs to hear about.
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

  -- An archive with nobody behind it is the cron's, and it writes its own line.
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

  FOREACH v_change IN ARRAY v_changes LOOP
    INSERT INTO public.activity_log
      (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES
      (NEW.id, v_actor, 'group_updated', 'group', NEW.id, v_change);
  END LOOP;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_log_group_changes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_log_group_changes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_log_group_changes() TO service_role;

DROP TRIGGER IF EXISTS groups_log_changes ON public.groups;
CREATE TRIGGER groups_log_changes AFTER UPDATE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION public.waves_log_group_changes();

-- ──────────────────────────────────────────── group_members ──

CREATE OR REPLACE FUNCTION public.waves_log_member_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_actor   uuid;
  v_name    text;
  v_verb    text;
  v_payload jsonb;
BEGIN
  -- The caller's membership in this group. Somebody leaving has `left_at` set
  -- on the very row being written, so their own row still counts for them.
  IF v_profile IS NOT NULL THEN
    SELECT gm.id INTO v_actor
      FROM public.group_members gm
     WHERE gm.group_id = NEW.group_id
       AND gm.profile_id = v_profile
       AND (gm.left_at IS NULL OR gm.id = NEW.id)
     ORDER BY (gm.left_at IS NULL) DESC
     LIMIT 1;
  END IF;

  v_name := COALESCE(
    NEW.ghost_name,
    (SELECT p.display_name FROM public.profiles p WHERE p.id = NEW.profile_id));

  IF TG_OP = 'INSERT' THEN
    -- Only a person somebody put in by hand. A join writes `joined` itself, the
    -- creator is covered by `created`, and an import batch by `imported`.
    IF NEW.joined_via IN ('ghost', 'contact')
       AND NEW.import_batch_id IS NULL
       AND NEW.left_at IS NULL THEN
      v_verb := 'member_added';
      v_payload := jsonb_build_object(
        'name', v_name, 'via', NEW.joined_via, 'placeholder', NEW.profile_id IS NULL);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.left_at IS NULL AND NEW.left_at IS NOT NULL THEN
      -- A merge and a claim approval both retire a row and say so themselves.
      IF NEW.merged_into_member_id IS NOT NULL
         OR (OLD.profile_id IS NOT NULL AND NEW.profile_id IS NULL) THEN
        RETURN NEW;
      END IF;
      IF NEW.removed_at IS NOT NULL THEN
        v_verb := 'member_removed';
      ELSIF NEW.import_batch_id IS NOT NULL THEN
        -- An import's placeholder cannot leave; the only thing that retires
        -- it is waves_undo_import, whose one `import_undone` row covers them.
        RETURN NEW;
      ELSE
        v_verb := 'member_left';
      END IF;
      v_payload := jsonb_build_object('name', v_name);
    ELSIF NEW.role IS DISTINCT FROM OLD.role
          AND NEW.left_at IS NULL
          -- A claim approval may set the role on the placeholder it hands
          -- over; that is the claim, already logged, not a promotion.
          AND NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id THEN
      v_verb := 'member_role_changed';
      v_payload := jsonb_build_object(
        'name', v_name, 'from', OLD.role::text, 'to', NEW.role::text);
    END IF;
  END IF;

  IF v_verb IS NOT NULL THEN
    INSERT INTO public.activity_log
      (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES
      (NEW.group_id, v_actor, v_verb, 'member', NEW.id, v_payload);
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_log_member_changes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_log_member_changes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.waves_log_member_changes() TO service_role;

DROP TRIGGER IF EXISTS group_members_log_changes ON public.group_members;
CREATE TRIGGER group_members_log_changes AFTER INSERT OR UPDATE ON public.group_members
    FOR EACH ROW EXECUTE FUNCTION public.waves_log_member_changes();
