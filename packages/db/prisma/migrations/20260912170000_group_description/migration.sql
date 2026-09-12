-- A group could say which one it was. It could not say what it was for.
--
-- `groups.name` is the only thing a group has ever been able to write about
-- itself, and a name is an identifier: "Goa", "Flat", "Dinner". It answers
-- *which* group, and it answers it to the people who were there when it was
-- made. Six months and four groups later, "Goa" does not say whether it is the
-- January trip with flights already settled or the one in August where they
-- were not, and the only way to find out is to open the ledger and read it.
--
-- So: one optional sentence, written by whoever makes the group, alongside the
-- name and on the same card, because it is part of the group's account of
-- itself rather than a setting about how it behaves.

-- ──────────────────────────────────────────────────────────── the column ──
--
-- Nullable with no default, like `name`: a group that says nothing about itself
-- is the normal case, not a degenerate one, and NULL is what "said nothing"
-- looks like. '' is deliberately not a supported state — it renders as a blank
-- line wherever the description is shown, where NULL renders as nothing at all
-- — so the client and the `/sync` boundary both normalise an emptied field back
-- to NULL before it reaches here. This does not enforce that: a CHECK banning
-- '' would turn a client bug into a refused save, and the cost of one empty
-- string arriving is a blank line, not a wrong number.
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS description text;

-- 280 characters, and the number is a decision rather than an inheritance.
--
-- A description is a caption under a name — a sentence or two saying what this
-- group is for. Long enough that nobody has to abbreviate; short enough that it
-- stays a caption, rather than becoming a notes field every screen showing a
-- group then has to find room to render in full. `text` with a CHECK, not
-- `varchar(280)`, because the cap is a product rule that may change and an
-- ALTER on a constraint is cheaper to reason about than one on a column type.
--
-- `char_length`, not `length` or `octet_length`: the cap is in characters, and
-- a Tamil or Arabic description must get the same 280 as an English one. Eleven
-- bytes per character in one script and one in another would be a cap that
-- quietly means something different in every language the app speaks.
--
-- The client's `maxLength` on the input is the same number, expressed in
-- `apps/mobile/src/lib/groupDescription.ts` — so the field stops accepting
-- keystrokes rather than letting somebody type a paragraph and meet this
-- constraint as an unexplained save failure after tapping Create. That copy is
-- a courtesy; this one is the boundary.
DO $do$
BEGIN
  ALTER TABLE public.groups
    ADD CONSTRAINT groups_description_length
    CHECK (description IS NULL OR char_length(description) <= 280);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$do$;

-- ───────────────────────────────────────────── and the allowlist it needs ──
--
-- `waves_guard_group_columns` (20260910090000_group_column_guard) refuses any
-- column an ordinary member writes that is not on one hand-maintained list. It
-- was deliberately rewritten from "what is forbidden" to "what is allowed"
-- precisely so that a column added later is refused by default instead of
-- exposed by default — which means a new column the app *does* mean members to
-- write is invisible until it is named here. Adding it is the whole ceremony:
-- without this, the description typed on the create screen would be refused as
-- FORBIDDEN_COLUMN, and the refusal would arrive as a red mark on the sync
-- banner over a group that was otherwise made correctly.
--
-- The list is kept in step with `GROUP_UPDATABLE_FIELDS` in
-- `supabase/functions/sync/index.ts`, which is the same list; that one is a
-- convenience filter returning a tidy 400, and this one is the boundary that
-- holds when somebody skips `/sync` and PATCHes PostgREST directly.
--
-- Everything else in this function is 20260910090000 verbatim — same signature,
-- same trigger, same `current_user` gate, same photo check after the allowlist,
-- so `CREATE OR REPLACE` is enough and there is no return-type change to drop
-- around. Only the one array entry is new.
CREATE OR REPLACE FUNCTION public.waves_guard_group_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  -- Kept in step with `GROUP_UPDATABLE_FIELDS` in supabase/functions/sync/index.ts.
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
    'remind_evening_at'
  ];
  v_refused text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Compare the whole row rather than named columns, so the list above is the
  -- only thing anybody has to maintain. `to_jsonb` on a record gives one key per
  -- column with a jsonb `null` (not SQL NULL) for an empty one, so `IS DISTINCT
  -- FROM` compares cleanly in both directions — including the null-to-value and
  -- value-to-null writes, which is how a group gets resurrected.
  SELECT string_agg(changed.key, ', ' ORDER BY changed.key)
    INTO v_refused
    FROM jsonb_each(to_jsonb(NEW)) AS changed(key, value)
   WHERE changed.value IS DISTINCT FROM (to_jsonb(OLD) -> changed.key)
     AND NOT (changed.key = ANY (v_allowed));

  IF v_refused IS NOT NULL THEN
    -- Named in the message because the caller is usually our own client and the
    -- useful bug report is "which column", not "something was refused". The
    -- names are column names, not user data, so there is nothing to leak.
    RAISE EXCEPTION
      'FORBIDDEN_COLUMN: % is set by the server or through its own RPC, not by a direct write', v_refused
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Not a forbidden column — a forbidden *writer*. A member may set the photo
  -- path; only a group entitled to a photo may have one set.
  IF NEW.photo_path IS DISTINCT FROM OLD.photo_path
     AND NEW.photo_path IS NOT NULL
     AND NOT public.waves_can_upload_group_photo(NEW.id) THEN
    RAISE EXCEPTION 'PHOTO_GATE: a group photo is a paid feature'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END
$$;

GRANT EXECUTE ON FUNCTION public.waves_guard_group_columns() TO anon, authenticated, service_role;

-- `waves_create_group` is deliberately left alone.
--
-- The obvious place for a new field on a new group is the RPC that makes one,
-- and it is the wrong place here. `group.create` is the single mutation in this
-- app whose refusal takes something away: until it syncs, the queue overlay is
-- the only place that group exists, so a create the server will not accept ends
-- with somebody discarding it and the group going with it (see the
-- refusal-is-not-a-deletion note on `waves_create_group`'s history). Giving the
-- create a new argument gives it new ways to be refused — by a server that has
-- not yet run this migration, by a length the client let through — in exchange
-- for a field no group needs in order to exist.
--
-- So the client writes the description as an ordinary `group.update` queued
-- behind the create, the same way the trip dates and the starting budget
-- already ride behind it. Worst case there is a description that did not save
-- on a group that did, which is a retry rather than a loss.
