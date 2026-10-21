-- A Free account may START ten groups.
--
-- ADR-011 keeps the ledger free and this does not touch it: being in a group,
-- adding to it, settling it and exporting it stay free at any count, and being
-- invited into somebody else's group is never refused. What is capped is how
-- many groups one unpaid account can create — the same shape of ceiling as the
-- guest's one group (ADR-006 addendum), one level up.
--
-- What counts (`waves_created_group_count`), the same three rules the clients
-- apply in @waves/core `countsTowardGroupCap` so the number a screen shows and
-- the number the server refuses on are one number:
--   * groups this person created (`groups.created_by`), not groups they are in;
--   * deleted groups do not count; ARCHIVED ones do — archiving is a view, not a
--     way to make room, or the ceiling would be a formality;
--   * a pair — exactly two live members, the one-to-one ledger the People tab
--     draws as a person — does not count. Nothing on the server marks a pair
--     (apps/api/src/server/pair.ts); it is recognised by its live membership.
--
-- Who is paid: `waves_my_plan`, the one resolution the app reads (subscriptions
-- written by the RevenueCat webhook, promo rows, the Pro trial). A Pro account,
-- on a trial or not, has no ceiling.
--
-- Where it is enforced: `waves_assert_group_cap`, called first thing by
-- `waves_create_group` (every client path: the app, the sync function, the web,
-- the public API, the agent) and again by a BEFORE INSERT trigger on `groups`,
-- which closes the direct-insert door the `groups_insert` policy leaves open to
-- an edited client; and by a trigger on `group_members` the moment a pair gains
-- a third live member, so pairs cannot be made first and grown later. The trigger only looks at rows written under a PostgREST
-- JWT (anon/authenticated): service-role work — imports, seeds, the tests'
-- fixtures — is not a person tapping Create. The Splitwise importer, which
-- inserts as the service, asks `waves_assert_group_cap` itself.
--
-- The number is an `app_config` row like every other ceiling (ADR-011
-- addendum): `free_group_cap`, default 10. The clients carry the same 10 as
-- `FREE_GROUP_LIMIT` for the copy; the database is what refuses.
--
-- The refusal is raised with the default SQLSTATE (P0001), not 42501: the
-- public API maps 42501 to a bare "no access" before it reads the CODE, and
-- this one deserves its sentence.

INSERT INTO public.app_config (key, value, description) VALUES
  ('free_group_cap', 10,
   'Groups a Free account may create (its own, not deleted, pairs excluded). Pro is unlimited.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.waves_free_group_cap() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE((SELECT value FROM public.app_config WHERE key = 'free_group_cap'), 10);
$$;

REVOKE ALL ON FUNCTION public.waves_free_group_cap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_free_group_cap() TO authenticated, service_role;

-- Groups p_profile started that count toward the ceiling. `p_except` leaves one
-- group out: the one about to stop being a pair (see the group_members trigger).
CREATE OR REPLACE FUNCTION public.waves_created_group_count(p_profile uuid, p_except uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT count(*)::integer
    FROM public.groups g
   WHERE g.created_by = p_profile
     AND g.deleted_at IS NULL
     AND (p_except IS NULL OR g.id <> p_except)
     AND (SELECT count(*) FROM public.group_members gm
           WHERE gm.group_id = g.id AND gm.left_at IS NULL) <> 2;
$$;

REVOKE ALL ON FUNCTION public.waves_created_group_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waves_created_group_count(uuid, uuid) TO service_role;

-- Refuse when a Free account has started its share. A no-op for Pro.
CREATE OR REPLACE FUNCTION public.waves_assert_group_cap(p_profile uuid, p_except uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cap   integer;
  v_count integer;
BEGIN
  IF p_profile IS NULL THEN
    RETURN;
  END IF;
  IF (public.waves_my_plan(p_profile) ->> 'plan') = 'pro' THEN
    RETURN;
  END IF;
  v_cap := public.waves_free_group_cap();
  v_count := public.waves_created_group_count(p_profile, p_except);
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'FREE_GROUP_LIMIT: Free plan lets you create up to % groups. Upgrade to Pro for unlimited groups.', v_cap;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.waves_assert_group_cap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_assert_group_cap(uuid, uuid) TO authenticated, service_role;

-- A pair that gains a third live member becomes a group, and counts from that
-- moment — otherwise ten pairs plus one member each would be ten free groups.
-- Fires when a group's live membership goes from two to three (a new live row,
-- or a departed member coming back), under a person's JWT like the trigger on
-- `groups`; the group itself is left out of the count since it is the one
-- being added. Refused by name: the add (or the join) does not happen.
CREATE OR REPLACE FUNCTION public.waves_group_members_cap_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_role    text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_creator uuid;
  v_live    integer;
BEGIN
  IF v_role NOT IN ('anon', 'authenticated') OR NEW.left_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.left_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_live FROM public.group_members WHERE group_id = NEW.group_id AND left_at IS NULL;
  IF v_live = 3 THEN
    SELECT created_by INTO v_creator FROM public.groups WHERE id = NEW.group_id AND deleted_at IS NULL;
    PERFORM public.waves_assert_group_cap(v_creator, NEW.group_id);
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_group_members_cap_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS group_members_free_cap ON public.group_members;
CREATE TRIGGER group_members_free_cap AFTER INSERT OR UPDATE OF left_at ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.waves_group_members_cap_guard();

-- What the screens ask before opening the form: the ceiling, how much of it is
-- used, and whether one more may be started. Always the caller's own.
CREATE OR REPLACE FUNCTION public.waves_my_group_cap() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile uuid := public.waves_current_profile_id();
  v_paid    boolean;
  v_cap     integer := public.waves_free_group_cap();
  v_count   integer;
BEGIN
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('limit', v_cap, 'created', 0, 'paid', false, 'canCreate', true);
  END IF;
  v_paid := (public.waves_my_plan(v_profile) ->> 'plan') = 'pro';
  v_count := public.waves_created_group_count(v_profile);
  RETURN jsonb_build_object(
    'limit', v_cap,
    'created', v_count,
    'paid', v_paid,
    'canCreate', v_paid OR v_count < v_cap
  );
END
$$;

REVOKE ALL ON FUNCTION public.waves_my_group_cap() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_my_group_cap() TO authenticated, service_role;

-- The backstop on the table itself, for rows written under a person's JWT.
CREATE OR REPLACE FUNCTION public.waves_groups_cap_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_role text := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
BEGIN
  IF v_role IN ('anon', 'authenticated') THEN
    PERFORM public.waves_assert_group_cap(NEW.created_by);
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.waves_groups_cap_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS groups_free_cap ON public.groups;
CREATE TRIGGER groups_free_cap BEFORE INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.waves_groups_cap_guard();

-- waves_create_group from 20261009120000_settle_in_group_currency; the one
-- change is the `waves_assert_group_cap` call after the guest ceilings, before
-- anything is written. The replay branch (a known id the caller is already in)
-- stays above it: a retried create is not a new group.
CREATE OR REPLACE FUNCTION public.waves_create_group(p_name text DEFAULT NULL::text, p_type text DEFAULT 'other'::text, p_currency character DEFAULT 'INR'::bpchar, p_emoji text DEFAULT NULL::text, p_simplify boolean DEFAULT true, p_group_id uuid DEFAULT NULL::uuid, p_photo_path text DEFAULT NULL::text, p_country character DEFAULT NULL::bpchar, p_creator_member_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_group_id   uuid;
  v_member_id  uuid;
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_country    char(2) := nullif(btrim(upper(coalesce(p_country, ''))), '');
  v_is_guest   boolean;
  v_created_at timestamptz;
  v_group_count integer;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: a group needs an owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_profile_id) THEN
    RAISE EXCEPTION 'NO_PROFILE: profile % does not exist', v_profile_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_group_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.groups WHERE id = p_group_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = p_group_id AND gm.profile_id = v_profile_id AND gm.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'GROUP_EXISTS: that group id is already taken'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN p_group_id;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth'
         AND table_name = 'users'
         AND column_name = 'is_anonymous'
     ) THEN
    SELECT u.is_anonymous, u.created_at
      INTO v_is_guest, v_created_at
      FROM auth.users u
      WHERE u.id = v_profile_id;

    IF coalesce(v_is_guest, false) THEN
      IF now() >= v_created_at + interval '10 days' THEN
        RAISE EXCEPTION 'GUEST_TRIAL_EXPIRED: sign up to keep using Waves'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      SELECT count(*) INTO v_group_count
        FROM public.group_members
        WHERE profile_id = v_profile_id AND left_at IS NULL;

      IF v_group_count >= 1 THEN
        RAISE EXCEPTION 'GUEST_GROUP_LIMIT: sign up to be in more than one group'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  -- A Free account may start ten groups (this migration). Pro: no ceiling.
  PERFORM public.waves_assert_group_cap(v_profile_id);

  INSERT INTO public.groups
    (id, name, type, default_currency, cover_emoji, simplify_debts, created_by, photo_path,
     country_code, convert_to_group_currency)
  VALUES
    (COALESCE(p_group_id, gen_random_uuid()), v_name, p_type::"GroupType",
     upper(p_currency), p_emoji, p_simplify, v_profile_id, p_photo_path,
     COALESCE(v_country, (SELECT country_code FROM public.profiles WHERE id = v_profile_id)),
     true)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (id, group_id, profile_id, role, joined_via)
  VALUES (COALESCE(p_creator_member_id, gen_random_uuid()), v_group_id, v_profile_id, 'admin', 'creator')
  RETURNING id INTO v_member_id;

  INSERT INTO public.activity_log (group_id, actor_member_id, verb, object_type, object_id, payload)
  VALUES (v_group_id, v_member_id, 'created', 'group', v_group_id,
          jsonb_build_object('name', v_name));

  RETURN v_group_id;
END
$$;

REVOKE ALL ON FUNCTION public.waves_create_group(p_name text, p_type text, p_currency character, p_emoji text, p_simplify boolean, p_group_id uuid, p_photo_path text, p_country character, p_creator_member_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.waves_create_group(p_name text, p_type text, p_currency character, p_emoji text, p_simplify boolean, p_group_id uuid, p_photo_path text, p_country character, p_creator_member_id uuid) TO authenticated, service_role;
