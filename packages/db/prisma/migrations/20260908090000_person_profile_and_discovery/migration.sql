-- Who a person is, and their own say in how much of that anyone else gets.
--
-- The Friends list rolls people up into a balance and `waves_person_group_balances`
-- un-collapses that balance per group. Neither answers the question somebody
-- actually taps a row to ask: *who is this?* Two people called Priya in two
-- groups are two identical rows, and once a balance settles to zero the person
-- vanishes from the screen entirely, because that RPC ends in
-- `HAVING sum(n.net) <> 0`. Identity was never modelled here — only debt was.
--
-- Adding identity means adding contact details, and contact details are not
-- ours to hand out. So this migration is two halves that only make sense
-- together:
--
--   * `waves_person_profile` — one row about one person, with their email and
--     phone included *only* when they have said that is allowed.
--   * three columns on `profiles` where they say it, plus `waves_find_person`,
--     the reverse direction: being looked up by a number or an address someone
--     already has, which is the only way a person becomes findable in this app
--     without a group invite.
--
-- The two axes are deliberately independent, because they answer different
-- questions and conflating them is how these settings usually go wrong:
--
--   **Discoverability** ("can someone who already has my number find me?")
--   is about search. It is per channel, because knowing somebody's work email
--   and knowing their mobile number are not the same level of acquaintance.
--
--   **Contact visibility** ("can people I share a group with read my number off
--   my profile?") is about display. It is one switch, because a group-mate who
--   can see one channel gains very little from being denied the other.
--
-- One rule is deliberately *not* implemented server-side, because it needs no
-- server: if you found somebody by typing their phone number, the app shows you
-- that number back on the result. It cannot leak anything — you typed it.
-- Showing it is honesty about what the match means, not disclosure.

-- ─────────────────────────────────────────────────────── the three switches ──

-- Defaults are chosen so that today's behaviour is unchanged for everyone who
-- already has an account: this app has always tapped an existing account when
-- somebody adds a ghost by email or phone (see `waves_add_ghost_member` below),
-- so discovery has effectively been on and unconditional since M1. Defaulting
-- these to off would silently break every existing add-by-contact flow, and
-- would dress the change up as a fix for a leak people had already lived with.
-- The switches make it a choice; they do not make a different choice on
-- anyone's behalf.
--
-- Contact visibility defaults to 'groups' on the same reasoning: a group-mate
-- can already see the email or phone an invite was addressed to
-- (`group_members.invite_email` / `invite_phone`), so a profile showing it is
-- not new disclosure — it is the same fact, in the place people look for it.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable_by_phone boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS discoverable_by_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_visibility    text    NOT NULL DEFAULT 'groups';

DO $do$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_contact_visibility_check
    CHECK (contact_visibility IN ('nobody', 'groups'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$do$;

COMMENT ON COLUMN public.profiles.discoverable_by_phone IS
  'Can somebody who types this account''s exact phone number find it (waves_find_person).';
COMMENT ON COLUMN public.profiles.discoverable_by_email IS
  'Can somebody who types this account''s exact email address find it (waves_find_person).';
COMMENT ON COLUMN public.profiles.contact_visibility IS
  'Who may read this account''s email and phone off its profile: nobody, or people it shares a group with.';

-- ──────────────────────────────────────────────────── one person, one screen ──

-- Everything the person screen needs about one person, contact included when
-- and only when they allow it.
--
-- `p_person_key` is the same key the Friends list and
-- `waves_person_group_balances` use, resolved the same three ways: a profile id
-- is proof of one human, a ghost merge is the caller's own proof, and failing
-- both a ghost stays keyed to its own group membership. The caller must share
-- at least one active group with them — that is this app's only notion of
-- "knowing" somebody, and without it the function would be a profile oracle for
-- any uuid a caller cared to try.
--
-- SECURITY DEFINER because the email and phone live in `auth.users`, which no
-- ordinary role may read. The function is the whole boundary: it decides what
-- comes out, and it returns nothing at all for somebody the caller does not
-- already share a group with.
CREATE OR REPLACE FUNCTION public.waves_person_profile(p_person_key text)
RETURNS TABLE(
  person_key       text,
  display_name     text,
  avatar_url       text,
  is_ghost         boolean,
  is_you           boolean,
  shared_groups    integer,
  email            text,
  phone            text,
  payment_rail     text,
  payment_handle   text,
  country_code     character(2),
  -- The difference between "they have not told us" and "they have told us not
  -- to tell you". A screen that cannot tell those apart has to write a weasel
  -- sentence covering both; with this it can say the true one.
  contact_withheld boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me      uuid := public.waves_current_profile_id();
  v_profile uuid;
  v_shared  integer := 0;
  v_name    text;
  v_avatar  text;
  v_rail    text;
  v_handle  text;
  v_country character(2);
  v_ghost   boolean := true;
  v_visible boolean := false;
  v_email   text;
  v_phone   text;
BEGIN
  IF v_me IS NULL OR p_person_key IS NULL OR btrim(p_person_key) = '' THEN
    RETURN;
  END IF;

  -- Case 1: the key is a real account.
  IF p_person_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT p.id, p.display_name, p.avatar_url, p.payment_rail, p.payment_handle,
           p.country_code, (p.contact_visibility = 'groups')
      INTO v_profile, v_name, v_avatar, v_rail, v_handle, v_country, v_visible
      FROM public.profiles p
     WHERE p.id = p_person_key::uuid;
  END IF;

  IF v_profile IS NOT NULL THEN
    v_ghost := false;

    IF v_profile = v_me THEN
      -- Looking at yourself: your own contact details are always yours to see,
      -- and "shared groups" means every group you are in.
      v_shared := (SELECT count(*)::int FROM public.group_members gm
                    WHERE gm.profile_id = v_me AND gm.left_at IS NULL);
      v_visible := true;
    ELSE
      -- The shared-group count doubles as the permission check.
      SELECT count(DISTINCT mine.group_id)::int INTO v_shared
        FROM public.group_members mine
        JOIN public.group_members theirs
          ON theirs.group_id = mine.group_id
         AND theirs.left_at IS NULL
         AND theirs.profile_id = v_profile
       WHERE mine.profile_id = v_me
         AND mine.left_at IS NULL;

      IF coalesce(v_shared, 0) = 0 THEN
        RETURN;
      END IF;
    END IF;

  ELSE
    -- Cases 2 and 3: a merged ghost (the caller's own merge) or a plain ghost.
    -- Either way there is no account, so there is nothing to reveal and the
    -- only question is whether the caller can see this person at all.
    SELECT max(coalesce(mrg.display_name, gm.ghost_name, 'Someone')),
           count(DISTINCT gm.group_id)::int
      INTO v_name, v_shared
      FROM public.group_members gm
      JOIN public.group_members mine
        ON mine.group_id = gm.group_id
       AND mine.profile_id = v_me
       AND mine.left_at IS NULL
      LEFT JOIN public.ghost_merges mrg
        ON mrg.member_id = gm.id
       AND mrg.owner = v_me
     WHERE gm.left_at IS NULL
       AND gm.profile_id IS NULL
       AND coalesce(mrg.person_id::text, gm.id::text) = p_person_key;

    IF coalesce(v_shared, 0) = 0 THEN
      RETURN;
    END IF;
  END IF;

  -- The reveal. Guarded on `auth.users` existing for the same reason every
  -- other read of it in this schema is: the DB test suite and the self-host
  -- stack run these RPCs against a Postgres with no `auth` schema, where the
  -- right answer is "no contact on file", not an error.
  IF NOT v_ghost AND v_visible AND to_regclass('auth.users') IS NOT NULL THEN
    SELECT nullif(btrim(lower(coalesce(u.email, ''))), ''),
           -- Stored bare in `auth.users`; the '+' is put back so the number is
           -- dialable and reads like every other number in the app.
           CASE WHEN nullif(btrim(coalesce(u.phone, '')), '') IS NULL THEN NULL
                ELSE '+' || regexp_replace(u.phone, '[^0-9]', '', 'g') END
      INTO v_email, v_phone
      FROM auth.users u
     WHERE u.id = v_profile
       AND u.deleted_at IS NULL;
  END IF;

  person_key       := p_person_key;
  display_name     := coalesce(v_name, 'Someone');
  avatar_url       := v_avatar;
  is_ghost         := v_ghost;
  is_you           := (v_profile IS NOT NULL AND v_profile = v_me);
  shared_groups    := coalesce(v_shared, 0);
  email            := v_email;
  phone            := v_phone;
  payment_rail     := CASE WHEN v_visible THEN v_rail ELSE NULL END;
  payment_handle   := CASE WHEN v_visible THEN v_handle ELSE NULL END;
  country_code     := CASE WHEN v_visible THEN v_country ELSE NULL END;
  contact_withheld := (NOT v_ghost) AND (NOT v_visible);
  RETURN NEXT;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_person_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_person_profile(text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────── being looked up ──

-- Exact-match lookup is a small, useful capability and a large, obvious abuse
-- surface: the same call that finds your friend's account from the number in
-- your address book will, run a hundred thousand times, tell somebody which
-- phone numbers in a range have Waves accounts. Three things keep that in
-- proportion, and none of them is sufficient alone:
--
--   * exact match only — no prefix, no LIKE, no fuzzy name search, so there is
--     nothing to walk;
--   * the target's own consent, per channel;
--   * a per-caller daily ceiling, counting misses as well as hits, since it is
--     the misses that a sweep is made of.
--
-- The ceiling is an `app_config` knob rather than a constant for the same
-- reason the other caps are: it is the number most likely to be wrong, and
-- changing it should not need a release.
CREATE TABLE IF NOT EXISTS public.person_lookups (
    profile_id uuid NOT NULL,
    day        date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
    lookups    integer NOT NULL DEFAULT 0,
    CONSTRAINT person_lookups_pkey PRIMARY KEY (profile_id, day),
    CONSTRAINT person_lookups_count_nonneg CHECK (lookups >= 0)
);

COMMENT ON TABLE public.person_lookups IS
  'Per-caller daily count of waves_find_person calls, hits and misses alike. Rate limiting only; not history anyone is shown.';

-- Nobody reads or writes this directly — the definer function is the only door.
ALTER TABLE public.person_lookups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_lookups FROM PUBLIC;
REVOKE ALL ON TABLE public.person_lookups FROM anon, authenticated;
GRANT ALL ON TABLE public.person_lookups TO service_role;

INSERT INTO public.app_config (key, value, description)
VALUES ('person_lookup_daily_cap', 40,
        'How many find-a-person lookups one account may run per UTC day, misses included.')
ON CONFLICT (key) DO NOTHING;

-- Spend one lookup and say how many have been spent today.
--
-- Its own function rather than an INSERT inside `waves_find_person` for a
-- boring reason worth recording: that function returns a column called
-- `profile_id`, and inside plpgsql an OUT parameter of that name makes every
-- reference to the `person_lookups.profile_id` column ambiguous. Pulling the
-- write out here removes the collision instead of papering over it with
-- `#variable_conflict`, and leaves the counter testable on its own.
CREATE OR REPLACE FUNCTION public.waves_spend_person_lookup() RETURNS integer
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $fn$
DECLARE
  v_me   uuid := public.waves_current_profile_id();
  v_used integer;
BEGIN
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.person_lookups AS pl (profile_id, day, lookups)
  VALUES (v_me, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (profile_id, day)
  DO UPDATE SET lookups = pl.lookups + 1
  RETURNING pl.lookups INTO v_used;

  RETURN v_used;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_spend_person_lookup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_spend_person_lookup() TO authenticated, service_role;

-- Find one account by an exact email address or phone number.
--
-- Returns at most one row, and only when that account has left the matching
-- channel discoverable. A miss and a refusal are deliberately indistinguishable
-- to the caller: if "no such account" and "they have turned this off" looked
-- different, the switch would itself become the oracle it exists to close.
--
-- `already_shared` is the one extra fact worth returning, because it changes
-- what the app offers next — somebody you are already in a group with does not
-- need adding, they need opening.
CREATE OR REPLACE FUNCTION public.waves_find_person(p_channel text, p_value text)
RETURNS TABLE(
  profile_id     uuid,
  display_name   text,
  avatar_url     text,
  already_shared boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me         uuid := public.waves_current_profile_id();
  v_channel    text := lower(btrim(coalesce(p_channel, '')));
  v_email      text;
  v_phone_bare text;
  v_cap        integer;
  v_used       integer;
  v_hit        uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: sign in to look somebody up'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_channel NOT IN ('email', 'phone') THEN
    RAISE EXCEPTION 'UNKNOWN_CHANNEL: look up by email or phone'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_channel = 'email' THEN
    v_email := nullif(btrim(lower(coalesce(p_value, ''))), '');
    -- Not validation, just a floor: an empty or obviously non-address string
    -- should not spend one of the caller's daily lookups.
    IF v_email IS NULL OR position('@' IN v_email) < 2 THEN
      RETURN;
    END IF;
  ELSE
    v_phone_bare := nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '');
    IF v_phone_bare IS NULL OR length(v_phone_bare) < 6 THEN
      RETURN;
    END IF;
  END IF;

  -- Spend one lookup. Counted before the search runs, so an error or a miss
  -- costs the same as a hit.
  v_cap := coalesce((SELECT value FROM public.app_config WHERE key = 'person_lookup_daily_cap'), 40);
  v_used := public.waves_spend_person_lookup();

  IF v_used > v_cap THEN
    RAISE EXCEPTION 'LOOKUP_RATE_LIMIT: too many lookups today'
      USING ERRCODE = 'too_many_connections';
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;

  SELECT u.id INTO v_hit
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
   WHERE u.deleted_at IS NULL
     AND u.id <> v_me
     AND (
       (v_channel = 'email'
        AND p.discoverable_by_email
        AND lower(u.email) = v_email)
       OR
       (v_channel = 'phone'
        AND p.discoverable_by_phone
        AND regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = v_phone_bare)
     )
   LIMIT 1;

  IF v_hit IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.display_name,
         p.avatar_url,
         EXISTS (
           SELECT 1
             FROM public.group_members mine
             JOIN public.group_members theirs
               ON theirs.group_id = mine.group_id
              AND theirs.left_at IS NULL
              AND theirs.profile_id = p.id
            WHERE mine.profile_id = v_me
              AND mine.left_at IS NULL
         )
    FROM public.profiles p
   WHERE p.id = v_hit;
END
$fn$;

REVOKE ALL ON FUNCTION public.waves_find_person(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_find_person(text, text) TO authenticated, service_role;

-- ────────────────────────────────────────────── what these switches do *not* do ──
--
-- `waves_add_ghost_member` also matches a typed email or phone against
-- `auth.users`, to link a person being added to a group with the account they
-- already have. That is deliberately left ungated by `discoverable_by_*`, and
-- it is worth writing down why, because it looks like the same thing and is
-- not:
--
--   * It tells the caller nothing. The function returns the new member id
--     whether or not an account matched, so it cannot be used to ask "does this
--     number have Waves" — which is the entire question these switches exist to
--     let somebody refuse.
--   * The person doing it already has your contact details in their hand and is
--     adding you to a group with them. Refusing the link would not hide you; it
--     would split your balance across a ghost and your account, which is a
--     ledger bug dressed up as a privacy win.
--
-- Discoverability governs being *searched for* by a stranger. It does not
-- govern being recognised by somebody who is already putting you in their
-- group.
