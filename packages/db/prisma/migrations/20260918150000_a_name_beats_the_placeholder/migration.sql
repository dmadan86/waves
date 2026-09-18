-- ═════════════ "Guest" is a placeholder, not a name — and it was outliving ═══
--                the moment it was true
--
-- A customer signed up with an email address and a password, confirmed the
-- address, later linked Google, and Waves went on calling them **Guest** — on
-- their own settings screen, and to everybody they split a bill with.
--
-- They were not a guest. `auth.users.is_anonymous` was already false and the
-- address was confirmed twenty seconds after the account was made. The word on
-- screen was their `profiles.display_name`, which is stamped exactly once, by
-- `waves_handle_new_user()`, from whatever the provider sent at the instant the
-- `auth.users` row appeared:
--
--     COALESCE(display_name, full_name, name, 'Guest')
--
-- An email sign-up sends none of those three, so the fallback lands — correct
-- at that instant, since nobody has said what to call them. The bug is that
-- nothing ever revisits it. The trigger is `AFTER INSERT` only, so when the
-- same account later gained `full_name` and `name` from a linked Google
-- identity, the placeholder stayed exactly where it was. There was no path in
-- the product that could repair it but the person noticing and renaming
-- themselves — which is the support ticket this migration answers.
--
-- Two halves, in the usual order: the rule for every account from now on, then
-- the accounts already carrying the placeholder.
--
-- Deliberately **not** in scope: inventing a name for somebody who has never
-- supplied one. An account that signed up by email and linked nothing has no
-- name anywhere, and the email local part is a login, not what a person is
-- called. That case is fixed on the way in, by asking — see the name field on
-- the sign-up door in `apps/mobile/src/components/AuthFlow.tsx`. This file only
-- ever carries across a name the account already holds.

-- ─────────────────────────────────── 0. the one reading of the metadata ──
--
-- The same COALESCE ladder `waves_handle_new_user()` uses, as a function, so
-- the insert path and the repair path cannot drift apart into two different
-- answers about what an account is called. NULL means the metadata names
-- nobody — which is the common case and not a failure.
CREATE OR REPLACE FUNCTION public.waves_metadata_name(p_meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    NULLIF(btrim(p_meta ->> 'display_name'), ''),
    NULLIF(btrim(p_meta ->> 'full_name'), ''),
    NULLIF(btrim(p_meta ->> 'name'), '')
  );
$$;

COMMENT ON FUNCTION public.waves_metadata_name(jsonb) IS
  'The name a provider sent, under whichever of its three keys it chose. NULL when it sent none.';

-- Not a definer function and it touches nothing, but the default grant to
-- PUBLIC is still restated rather than inherited, for the same reason every
-- other function in this schema says who may call it.
REVOKE ALL ON FUNCTION public.waves_metadata_name(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_metadata_name(jsonb) TO service_role;

-- ────────────────────────────── 1. a real name replaces the placeholder ──
--
-- The rule itself, as an ordinary function rather than a trigger body. The
-- trigger below is the only thing that calls it in production, but a rule
-- sealed inside a trigger on `auth.users` is a rule that cannot be tested: the
-- local and CI databases are plain Postgres with no `auth` schema at all, so
-- the trigger is correctly never created there and every case it decides would
-- go unchecked. Split this way, the decision runs anywhere a `profiles` row
-- exists — see `packages/db/test/nameOverPlaceholder.test.ts`, where the case
-- that matters (a name somebody chose is never overwritten) is one assertion.
--
-- Returns whether it renamed anybody, so the caller and the test can tell "no
-- name to write" from "already named" without re-reading the row.
CREATE OR REPLACE FUNCTION public.waves_name_over_placeholder(p_user uuid, p_meta jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text;
  v_rows integer;
BEGIN
  v_name := public.waves_metadata_name(p_meta);
  IF v_name IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Only over the placeholder. Somebody who named themselves two years ago is
  -- never renamed by a provider they linked today — the same rule
  -- `waves_approve_member_claim` already applies to the name a join request
  -- carries.
  UPDATE public.profiles
     SET display_name = v_name
   WHERE id = p_user
     AND (display_name IS NULL OR display_name = '' OR display_name = 'Guest');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END
$$;

COMMENT ON FUNCTION public.waves_name_over_placeholder(uuid, jsonb) IS
  'Carries a provider name onto a profile still holding the "Guest" placeholder. Never over a name somebody chose.';

-- A definer function that writes `profiles` bypasses RLS, so no client role may
-- reach it: a caller who could pass any uuid could rename any unnamed stranger.
-- The trigger invokes it as the definer; nobody else calls it at all.
REVOKE ALL ON FUNCTION public.waves_name_over_placeholder(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_name_over_placeholder(uuid, jsonb) TO service_role;

-- The trigger is now only the part that cannot be tested without Supabase:
-- which rows to offer, and when.
--
-- It fires on every `auth.users` update that touches either column, which is a
-- busy trigger, so the cheap refusal comes first. `is_anonymous` is read
-- through `NEW` in plpgsql rather than named in a SQL body on purpose: CI runs
-- these migrations against a stub `auth` schema whose users table has no such
-- column, and a SQL function naming a missing column fails at CREATE. plpgsql
-- resolves it when the trigger runs, and the trigger is only created where the
-- column exists. Same guard, same reason, as `waves_promote_guest`.
CREATE OR REPLACE FUNCTION public.waves_handle_user_named()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- An account nobody has claimed keeps the placeholder: "Guest" is the honest
  -- word for an anonymous session, and this is only about the accounts where it
  -- has stopped being true. A guest who upgrades passes here twice — once when
  -- the metadata arrives and is refused, and again when the confirmation clears
  -- `is_anonymous`, which is why that column is in the trigger's UPDATE OF list.
  IF NEW.is_anonymous THEN
    RETURN NEW;
  END IF;

  PERFORM public.waves_name_over_placeholder(NEW.id, NEW.raw_user_meta_data);
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.waves_handle_user_named() IS
  'AFTER UPDATE on auth.users: offers a newly-arrived provider name to a profile still holding the placeholder.';

REVOKE ALL ON FUNCTION public.waves_handle_user_named() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_handle_user_named() TO service_role;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE NOTICE 'no auth.users (bare Postgres) — user-named trigger skipped';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_anonymous'
  ) THEN
    RAISE NOTICE 'auth.users has no is_anonymous (stub schema) — user-named trigger skipped';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS waves_on_auth_user_named ON auth.users;
  CREATE TRIGGER waves_on_auth_user_named
    AFTER UPDATE OF raw_user_meta_data, is_anonymous ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.waves_handle_user_named();
END
$$;

-- ─────────────────────────── 2. the accounts already wearing the word ──
--
-- The repair, for every account the trigger would have caught had it existed.
-- Idempotent: a second run matches nothing, because the placeholder is gone
-- from the rows it fixed and never present on the rows it skipped.
DO $$
DECLARE
  v_rows integer;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_anonymous'
  ) THEN
    RETURN;
  END IF;

  -- Through the same function the trigger calls, so the repair and the rule
  -- cannot disagree about who gets renamed.
  EXECUTE $backfill$
    SELECT count(*) FILTER (
      WHERE public.waves_name_over_placeholder(u.id, u.raw_user_meta_data)
    )
      FROM auth.users u
      JOIN public.profiles p ON p.id = u.id
     WHERE NOT u.is_anonymous
       AND (p.display_name IS NULL OR p.display_name = '' OR p.display_name = 'Guest')
  $backfill$ INTO v_rows;

  RAISE NOTICE 'profiles renamed off the placeholder: %', v_rows;
END
$$;
