-- A group could say what kind it was, and (via event_template) what kind of event.
-- It could not carry the owner's own word for it — "Office offsite", "Diwali 2026".
--
-- `groups.custom_tag` is one optional short label a member types to organise
-- their groups. When set, the app shows it in place of the automatic type tag.
-- Nullable, no default: a group with no tag is the normal case, and NULL is what
-- that looks like ('' is not a supported state — the client and `/sync` both
-- normalise an emptied field to NULL, and the CHECK below refuses a blank one).
--
-- Old clients never read or write the column, so they keep working unchanged.
-- Deploy order: this migration, then the `sync` edge function (allowlist), then
-- the app.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS custom_tag text;

-- 24 characters, counted as characters (not bytes) so a Tamil or Arabic tag gets
-- the same room as an English one; trimmed and non-empty so it never renders as
-- a blank pill. The client copy of the number is `GROUP_TAG_MAX` in
-- apps/mobile/src/lib/groupTypeTag.ts.
DO $do$
BEGIN
  ALTER TABLE public.groups
    ADD CONSTRAINT groups_custom_tag_shape
    CHECK (
      custom_tag IS NULL
      OR (char_length(custom_tag) <= 24 AND custom_tag = btrim(custom_tag) AND custom_tag <> '')
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$do$;

COMMENT ON COLUMN public.groups.custom_tag IS
  'Optional member-typed short tag (max 24 chars, trimmed, non-empty) shown instead of the automatic type tag. NULL when unset.';

--
-- Name: waves_guard_group_columns(); Type: FUNCTION; Schema: public; Owner: -
--
-- CREATE OR REPLACE verbatim from 20261003120000_event_organizer_mvp, with
-- 'custom_tag' added to the allowlist. Kept in step with `GROUP_UPDATABLE_FIELDS`
-- in supabase/functions/sync/index.ts.

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
    'remind_evening_at',
    'event_template',
    'custom_tag'
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
