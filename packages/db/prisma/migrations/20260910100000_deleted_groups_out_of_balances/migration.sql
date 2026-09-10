-- A deleted group still counted towards what people owed each other.
--
-- Deleting a group is a tombstone, not an erasure (ADR-004, A49):
-- `waves_delete_group` stamps `groups.deleted_at` and leaves everything
-- underneath it exactly where it was — the expenses, the settlements, the
-- `pairwise_balances` rows, and the `group_members` rows, whose `left_at` stays
-- NULL because nobody left. That is deliberate, and it has to stay that way: the
-- tombstone rides the sync pull so every device learns the group is gone, and it
-- can only do that if the rows survive to carry it.
--
-- What nothing did was *read* the tombstone. Before this migration
-- `groups.deleted_at` was written by exactly one statement and consulted by
-- none: no RPC, no RLS policy, no trigger, no scheduled job. The soft delete was
-- strictly weaker server-side than the archive, which at least three functions
-- did check — backwards, since one means "put away" and the other means "gone".
--
-- A user found the sharp end of it: the same Splitwise export imported three
-- times, two copies deleted, and a person screen reading "You owe ₹1,192.72 ·
-- across 2 groups" over two identically-named rows, one of which was a link to
-- "Group not found". The money was double-counted, not merely mis-listed.
--
-- This migration fixes the readers where a wrong answer reaches a person:
--
--   1. the two Friends balance RPCs, which is the reported bug;
--   2. `waves_person_profile`'s "groups in common" count, which is also the gate
--      on revealing somebody's email and phone — so this one is a privacy leak
--      wearing a cosmetic bug's clothes;
--   3. the three scheduled jobs that act on groups and then send mail or push —
--      the weekly digest, the trip nudges, and the settlement auto-confirm;
--   4. the auto-archive sweep, whose UPDATE bumps `updated_seq` and drags a dead
--      group and its whole child set back through every ex-member's sync delta;
--   5. the account-deletion preview, which warned about outstanding balances in
--      groups that no longer exist;
--   6. `waves_consume_invite`, so a durable join link (A47) for a deleted group
--      stops letting people join it — and stops burning a guest's one-group
--      ceiling on a group they will never see.
--
-- ────────────────────────────────────── why not fix it at the root instead ──
--
-- The obvious root fix is `is_group_member` / `is_group_admin`: they read
-- `group_members` alone, never mention `public.groups`, and sit under roughly
-- thirty RLS policies and forty-five RPCs. Teaching those two to require
-- `deleted_at IS NULL` would close most of this in one edit. It was worked
-- through and rejected, and the reasons are recorded so the next person does not
-- have to rediscover them:
--
--   * `groups_select` is built on `is_group_member`. A member who cannot read
--     the deleted group's own row never receives the tombstone, so the group
--     never leaves their mirror — the delete would stop working on precisely the
--     devices it exists to reach. The group's row must stay readable while its
--     children stop counting, and one predicate cannot say both.
--   * `waves_delete_group` is documented and tested as idempotent so a retried
--     offline queue flush lands cleanly. Its admin gate runs *before* its
--     already-deleted check, so a deleted-aware `is_group_admin` would turn the
--     second delete into `NOT_ADMIN` instead of a no-op.
--   * They are the hottest predicates in the schema. Adding a join to both, for
--     a column that is NULL on virtually every row, is a large unmeasured change
--     to make in the same breath as a correctness fix.
--
-- So the read side is fixed per caller. What that leaves — deliberately, and
-- listed in the PR rather than quietly — is the write side: every group-scoped
-- write RPC still accepts a deleted group, so a late-flushed offline mutation
-- can still write into one, and `waves_touch_balances` will rebuild its
-- `pairwise_balances` when it does. That wants its own change, its own test, and
-- a decision about what a client should be told when its queued expense lands in
-- a group that has since gone.
--
-- ─────────────────────────────────────── deleted is gone; archived is not ──
--
-- `archived_at` is not `deleted_at`, and they are treated differently here on
-- purpose. The rule this migration settles on, in one sentence: **a deleted
-- group is gone from everything; an archived group stays out of the surfaces
-- about what is happening now, and stays in the ones about what two people owe
-- each other.**
--
-- Archiving is offered as the calm way to clear a finished trip off the
-- dashboard *without deleting its ledger*. Dropping its debts out of "what do I
-- owe Hethu" would quietly break that promise: the money is real, nobody left,
-- and the group is one tap of Unarchive away. So the balance RPCs below filter
-- `deleted_at` only. The scheduled jobs keep their existing `archived_at`
-- filters untouched, because they ask a different question — a trip that has
-- been put away is not having a week to report and does not want a "what did you
-- spend today?" push at nine in the morning.
--
-- That decision has a client half, made in the same change, because the server
-- and the offline mirror disagreed about archived groups in *both* directions:
-- the mirror dropped them from the Friends list while the server counted them on
-- the person screen you reach by tapping a row in that list, so the same
-- question had two answers. The mirror now counts an archived group's balance
-- too, and the group screen — which refused to open an archived group, and would
-- otherwise have made every archived row on the person screen a dead link — now
-- opens one.
--
-- No signature and no return type changes anywhere here, so `CREATE OR REPLACE`
-- is enough and there is no 42P13 to drop around. Grants are restated all the
-- same: a replace keeps them, but this repo has been bitten by assuming that in
-- the other direction, and restating them costs nothing.

-- ══════════════════════════════════ 0. something to look the column up by ══
--
-- `archived_at` has had an index since the baseline; `deleted_at` never did,
-- because until now nothing read it. Every function below has to prove a group
-- is not a tombstone, which puts `deleted_at IS NULL` in about as many
-- predicates as `archived_at IS NULL`, so it gets the twin of the index its
-- sibling already has. Plain rather than partial, to match `groups_archived_at_idx`
-- and to stay the shape Prisma's `@@index([deletedAt])` describes — a partial
-- index here would be a permanent drift finding for a table this small.
CREATE INDEX IF NOT EXISTS groups_deleted_at_idx ON public.groups USING btree (deleted_at);

-- ═══════════════════════════ 1. who owes me, and who I owe, per person ══

CREATE OR REPLACE FUNCTION public.waves_people_i_owe() RETURNS TABLE(person_key text, profile_id uuid, member_id uuid, display_name text, avatar_url text, is_ghost boolean, currency character, net bigint, group_count integer, only_group_id uuid, last_activity_at timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH me AS (
    -- The one gate, and it belongs here rather than at the end. `group_members`
    -- alone cannot tell a live group from a tombstoned one — a delete does not
    -- touch `left_at`, because nobody left — so the group row has to be
    -- consulted, and everything downstream inherits the answer by joining back
    -- to `me` on `group_id`: the edges, the sum, `group_count` and
    -- `only_group_id` all follow, with no second filter to forget.
    --
    -- Archived groups are deliberately still here. The money in one is real and
    -- the group is one tap of Unarchive away; it is the dashboard's list of
    -- what is going on now that hides it, not the ledger.
    SELECT gm.id AS member_id, gm.group_id
      FROM public.group_members gm
      JOIN public.groups g
        ON g.id = gm.group_id
       AND g.deleted_at IS NULL
     WHERE gm.profile_id = public.waves_current_profile_id()
       AND gm.left_at IS NULL
  ),
  edges AS (
    SELECT pb.group_id, pb.to_member_id AS other_member_id, pb.currency, -pb.amount AS net
      FROM public.pairwise_balances pb
      JOIN me ON me.group_id = pb.group_id AND me.member_id = pb.from_member_id
    UNION ALL
    SELECT pb.group_id, pb.from_member_id, pb.currency, pb.amount
      FROM public.pairwise_balances pb
      JOIN me ON me.group_id = pb.group_id AND me.member_id = pb.to_member_id
  ),
  -- The newest activity per member, from every place a member leaves a
  -- timestamp: expense versions they paid or shared, and settlements either way.
  -- Deliberately not filtered by group: a member id belongs to exactly one
  -- group, and only members reached through `edges` are ever looked up here, so
  -- a dead group's timestamps have nothing to attach themselves to.
  member_activity AS (
    SELECT a.member_id, max(a.ts) AS last_activity_at
      FROM (
        SELECT epy.member_id, ev.created_at AS ts
          FROM public.expense_payers epy
          JOIN public.expense_versions ev ON ev.id = epy.expense_version_id
          JOIN public.expenses ex ON ex.id = ev.expense_id AND ex.deleted_at IS NULL
        UNION ALL
        SELECT esh.member_id, ev.created_at
          FROM public.expense_shares esh
          JOIN public.expense_versions ev ON ev.id = esh.expense_version_id
          JOIN public.expenses ex ON ex.id = ev.expense_id AND ex.deleted_at IS NULL
        UNION ALL
        SELECT s.from_member_id, s.created_at FROM public.settlements s
        UNION ALL
        SELECT s.to_member_id, s.created_at FROM public.settlements s
      ) a(member_id, ts)
      GROUP BY a.member_id
  ),
  named AS (
    SELECT
      e.group_id,
      e.currency,
      e.net,
      gm.id            AS member_id,
      gm.profile_id,
      -- A profile id is proof of one human; a ghost merge is the caller's own
      -- proof; failing both, a ghost stays keyed to its own group.
      COALESCE(gm.profile_id::text, mrg.person_id::text, gm.id::text) AS person_key,
      COALESCE(p.display_name, mrg.display_name, gm.ghost_name, 'Someone') AS display_name,
      COALESCE(p.avatar_url, public.waves_gravatar_url(gm.invite_email)) AS avatar_url,
      gm.profile_id IS NULL AS is_ghost,
      ma.last_activity_at
    FROM edges e
    JOIN public.group_members gm ON gm.id = e.other_member_id
    LEFT JOIN public.profiles p ON p.id = gm.profile_id
    LEFT JOIN member_activity ma ON ma.member_id = gm.id
    LEFT JOIN public.ghost_merges mrg
      ON mrg.member_id = gm.id
     AND mrg.owner = public.waves_current_profile_id()
  )
  SELECT
    n.person_key,
    max(n.profile_id::text)::uuid                       AS profile_id,
    max(n.member_id::text)::uuid                        AS member_id,
    max(n.display_name)                                 AS display_name,
    max(n.avatar_url)                                   AS avatar_url,
    bool_and(n.is_ghost)                                AS is_ghost,
    n.currency,
    sum(n.net)::bigint                                  AS net,
    count(DISTINCT n.group_id)::int                     AS group_count,
    CASE WHEN count(DISTINCT n.group_id) = 1
         THEN max(n.group_id::text)::uuid END           AS only_group_id,
    max(n.last_activity_at)                             AS last_activity_at
  FROM named n
  GROUP BY n.person_key, n.currency
  HAVING sum(n.net) <> 0
  ORDER BY abs(sum(n.net)) DESC, max(n.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.waves_people_i_owe() TO authenticated, service_role;

-- ─────────────────────────────── that same balance, un-collapsed per group ──

CREATE OR REPLACE FUNCTION public.waves_person_group_balances(p_person_key text) RETURNS TABLE(group_id uuid, group_name text, cover_emoji text, currency character, net bigint, is_ghost boolean, display_name text)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH me AS (
    -- The same gate as `waves_people_i_owe`, and it has to be the same one: this
    -- function exists to explain that function's total, so a group either counts
    -- in both or in neither. The join at the bottom of this query already reads
    -- `public.groups` for the name and the emoji, and would have been the
    -- obvious place to filter — but filtering there would state the rule twice
    -- in two different shapes, which is how two answers to one question start.
    SELECT gm.id AS member_id, gm.group_id
      FROM public.group_members gm
      JOIN public.groups g
        ON g.id = gm.group_id
       AND g.deleted_at IS NULL
     WHERE gm.profile_id = public.waves_current_profile_id()
       AND gm.left_at IS NULL
  ),
  edges AS (
    SELECT pb.group_id, pb.to_member_id AS other_member_id, pb.currency, -pb.amount AS net
      FROM public.pairwise_balances pb
      JOIN me ON me.group_id = pb.group_id AND me.member_id = pb.from_member_id
    UNION ALL
    SELECT pb.group_id, pb.from_member_id, pb.currency, pb.amount
      FROM public.pairwise_balances pb
      JOIN me ON me.group_id = pb.group_id AND me.member_id = pb.to_member_id
  ),
  named AS (
    SELECT
      e.group_id,
      e.currency,
      e.net,
      -- The same key the list rolls people up under: a profile id is proof of
      -- one human; a ghost merge is the caller's own proof; failing both, a
      -- ghost stays keyed to its own group membership.
      COALESCE(gm.profile_id::text, mrg.person_id::text, gm.id::text) AS person_key,
      COALESCE(p.display_name, mrg.display_name, gm.ghost_name, 'Someone') AS display_name,
      gm.profile_id IS NULL AS is_ghost
    FROM edges e
    JOIN public.group_members gm ON gm.id = e.other_member_id
    LEFT JOIN public.profiles p ON p.id = gm.profile_id
    LEFT JOIN public.ghost_merges mrg
      ON mrg.member_id = gm.id
     AND mrg.owner = public.waves_current_profile_id()
  )
  SELECT
    n.group_id,
    g.name         AS group_name,
    g.cover_emoji,
    n.currency,
    sum(n.net)::bigint    AS net,
    bool_and(n.is_ghost)  AS is_ghost,
    max(n.display_name)   AS display_name
  FROM named n
  JOIN public.groups g ON g.id = n.group_id
  WHERE n.person_key = p_person_key
  GROUP BY n.group_id, g.name, g.cover_emoji, n.currency
  HAVING sum(n.net) <> 0
  ORDER BY g.name, n.currency;
$$;

GRANT EXECUTE ON FUNCTION public.waves_person_group_balances(p_person_key text) TO authenticated, service_role;

-- ═══════════ 2. "N groups in common", and what that number unlocks ══════
--
-- The same person screen carries a second count inflated the same way:
-- `shared_groups`, rendered as "3 groups in common" under somebody's name.
--
-- It is not only a number. It is also the permission gate — a caller who shares
-- nothing with the subject gets an empty result rather than a profile, which is
-- what stops this function being an oracle for any uuid somebody cares to try —
-- and passing it is what authorises the reveal further down of the other
-- person's email, phone, payment rail, payment handle and country. A group both
-- parties had deleted therefore went on unlocking a stranger's contact details.
--
-- Archived groups stay counted here, which is the one place this migration parts
-- company with itself, because the question is a different one. The balance RPCs
-- ask which ledgers are live enough to add up; this asks whether two people know
-- each other. Putting a finished trip away does not make the people on it
-- strangers, nobody left, and the answer feeds a sentence about acquaintance —
-- not a sum of money and not a link to a screen.
--
-- Everything else in this function is 20260908090000_person_profile_and_discovery
-- verbatim; the only changes are the three counting queries and these comments.
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
      -- and "shared groups" means every group you are in — every group that
      -- still exists, that is.
      v_shared := (SELECT count(*)::int
                     FROM public.group_members gm
                     JOIN public.groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
                    WHERE gm.profile_id = v_me AND gm.left_at IS NULL);
      v_visible := true;
    ELSE
      -- The shared-group count doubles as the permission check.
      SELECT count(DISTINCT mine.group_id)::int INTO v_shared
        FROM public.group_members mine
        JOIN public.groups g
          ON g.id = mine.group_id
         AND g.deleted_at IS NULL
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
      JOIN public.groups g
        ON g.id = gm.group_id
       AND g.deleted_at IS NULL
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

  -- The reveal. Guarded on a real `auth.users` for the same reason every other
  -- read of it in this schema is: the DB test suite and the self-host stack run
  -- these RPCs against a Postgres with no `auth` schema, or with a stub one,
  -- where the right answer is "no contact on file", not an error.
  IF NOT v_ghost AND v_visible AND public.waves_auth_contact_readable() THEN
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

-- ═════════════════════ 3. the jobs that reach somebody's phone ══════════
--
-- A wrong number on a screen is a wrong number on a screen. These three send
-- mail and push, and all were counting or acting on groups their recipients had
-- deleted. Each keeps its existing `archived_at` filter unchanged — a trip put
-- away really is not having a week and really does not want a nudge — and gains
-- the `deleted_at` half that was never there.

-- ───────────────────────────────────────────────── the Monday morning mail ──
--
-- Both halves were wrong, differently. The expense count is the gate — an
-- account with a count of zero is skipped entirely — so a deleted group could be
-- the whole reason somebody received mail at all. The net figure is the headline
-- number inside it. Everything else is
-- 20260907150000_weekly_digest_involved_people verbatim, restated because
-- `CREATE OR REPLACE` replaces the whole body and a partial copy would silently
-- drop the preference checks.
CREATE OR REPLACE FUNCTION public.waves_enqueue_weekly_digest(p_now timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_since   timestamptz := p_now - interval '7 days';
  v_week    text := to_char(date_trunc('week', p_now), 'IYYY-"W"IW');
  v_person  record;
  v_written integer := 0;
  v_id      uuid;
BEGIN
  FOR v_person IN
    SELECT p.id,
           p.default_currency,
           -- Expenses filed in the last seven days where this person actually
           -- appears: the author/user, a payer/financer, or a share participant
           -- (traveller/rider). A group bystander did not have a week to report.
           (SELECT count(*)
              FROM public.expenses e
              JOIN public.expense_versions v ON v.id = e.current_version_id
              JOIN public.group_members m
                ON m.group_id = e.group_id
               AND m.profile_id = p.id
               AND m.left_at IS NULL
              JOIN public.groups g
                ON g.id = e.group_id
               AND g.archived_at IS NULL
               AND g.deleted_at IS NULL
             WHERE e.deleted_at IS NULL
               AND e.created_at > v_since
               AND (
                 v.author_member_id = m.id
                 OR EXISTS (
                   SELECT 1 FROM public.expense_payers ep
                    WHERE ep.expense_version_id = v.id AND ep.member_id = m.id
                 )
                 OR EXISTS (
                   SELECT 1 FROM public.expense_shares es
                    WHERE es.expense_version_id = v.id AND es.member_id = m.id
                 )
               )) AS expense_count,
           -- Net across every group, in their own currency only. Mixing
           -- currencies into one number would be a lie, and picking a
           -- "dominant" one would be a lie that changes week to week.
           COALESCE((
             SELECT SUM(CASE WHEN mine.side = 'to' THEN b.amount ELSE -b.amount END)
             FROM public.pairwise_balances b
             JOIN LATERAL (
               SELECT 'to' AS side FROM public.group_members m
                WHERE m.id = b.to_member_id AND m.profile_id = p.id
               UNION ALL
               SELECT 'from' FROM public.group_members m
                WHERE m.id = b.from_member_id AND m.profile_id = p.id
             ) mine ON TRUE
             JOIN public.groups g
               ON g.id = b.group_id
              AND g.archived_at IS NULL
              AND g.deleted_at IS NULL
             WHERE b.currency = p.default_currency
           ), 0) AS net_amount
    FROM public.profiles p
    WHERE NOT public.waves_is_guest(p.id)
      -- No address, no digest. The claim would suppress it a minute later
      -- anyway; not writing the row keeps the table honest about what was
      -- actually sendable.
      AND public.waves_email_for(p.id) IS NOT NULL
      AND COALESCE((p.notification_prefs ->> 'email')::boolean, TRUE)
      -- Opt-in, and the default is off. Settings → Notifications has carried
      -- "Weekly email digest … Off by default" since before anything produced
      -- one (`DEFAULT_NOTIFICATION_PREFS.weeklyEmail` is false), so a digest
      -- that shipped to everybody would make that screen a lie on the day it
      -- started working. Note the default here is FALSE, unlike every other
      -- preference in this file.
      AND COALESCE((p.notification_prefs ->> 'weeklyEmail')::boolean, FALSE)
  LOOP
    -- Nothing happened: say nothing. This is the whole difference between a
    -- digest people read and a digest people filter.
    CONTINUE WHEN v_person.expense_count = 0;

    v_id := public.waves_notify(
      v_person.id,
      NULL,
      'digest_weekly',
      'Your week on Waves',
      v_person.expense_count::text || ' expenses',
      'waves://activity',
      jsonb_build_object(
        'count', v_person.expense_count::text,
        'amount', v_person.net_amount::text,
        'currency', v_person.default_currency
      ),
      'digest_weekly:' || v_person.id::text || ':' || v_week
    );

    IF v_id IS NOT NULL THEN
      v_written := v_written + 1;
    END IF;
  END LOOP;

  RETURN v_written;
END
$$;

REVOKE ALL ON FUNCTION public.waves_enqueue_weekly_digest(timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_enqueue_weekly_digest(timestamp with time zone) TO service_role;

-- ────────────────────────────────────── "Anything from yesterday?", forever ──
--
-- The nudges sweep every group whose trip dates bracket today. A deleted trip
-- whose dates still do went on pushing twice a day to every member, carrying a
-- deep link — `waves://group/<id>/add-expense` — into a screen the app correctly
-- refuses to show. Deleting a trip did not stop its reminders, which is about
-- the least forgivable shape this bug could take.
CREATE OR REPLACE FUNCTION public.waves_trip_nudges(p_now timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_group    record;
  v_member   record;
  v_local    timestamp;
  v_today    date;
  v_slot     text;
  v_subject  date;
  v_written  integer := 0;
  v_id       uuid;
BEGIN
  FOR v_group IN
    SELECT id, name, time_zone, start_date, end_date,
           remind_morning_at, remind_evening_at
    FROM public.groups
    WHERE remind_daily
      AND archived_at IS NULL
      AND deleted_at IS NULL
      AND start_date IS NOT NULL
      AND end_date   IS NOT NULL
  LOOP
    v_local := p_now AT TIME ZONE v_group.time_zone;
    v_today := v_local::date;

    -- Inclusive of both ends: the last day of a trip is the day with the most
    -- unrecorded spending on it.
    CONTINUE WHEN v_today < v_group.start_date OR v_today > v_group.end_date;

    -- Both slots are considered on every run rather than only the latest one.
    -- If cron is down all morning, the breakfast reminder should still go out
    -- late rather than not at all, and the dedupe key is what stops it going
    -- out twice.
    FOREACH v_slot IN ARRAY ARRAY['morning', 'evening']
    LOOP
    IF v_slot = 'morning' THEN
      CONTINUE WHEN v_local::time < v_group.remind_morning_at;
      -- At breakfast the interesting day is the one that just ended. On the
      -- first morning of a trip there is no yesterday worth asking about.
      v_subject := v_today - 1;
      CONTINUE WHEN v_subject < v_group.start_date;
    ELSE
      CONTINUE WHEN v_local::time < v_group.remind_evening_at;
      v_subject := v_today;
    END IF;

    FOR v_member IN
      SELECT m.id AS member_id, m.profile_id
      FROM public.group_members m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = v_group.id
        AND m.profile_id IS NOT NULL
        AND m.left_at IS NULL
        -- Somebody who turned nudges off has answered this question already.
        AND COALESCE((p.notification_prefs ->> 'nudges')::boolean, TRUE)
    LOOP
      -- Nobody is asked about a day they already recorded. This is the whole
      -- difference between a useful reminder and the kind people mute.
      CONTINUE WHEN EXISTS (
        SELECT 1
        FROM public.expenses e
        JOIN public.expense_versions v ON v.id = e.current_version_id
        WHERE e.group_id = v_group.id
          AND e.deleted_at IS NULL
          AND v.author_member_id = v_member.member_id
          AND v.expense_date = v_subject
      );

      v_id := public.waves_notify(
        v_member.profile_id,
        v_group.id,
        CASE v_slot WHEN 'morning' THEN 'trip_nudge_morning' ELSE 'trip_nudge_evening' END,
        CASE v_slot
          WHEN 'morning' THEN 'Anything from yesterday?'
          ELSE 'Add today before you forget'
        END,
        CASE v_slot
          WHEN 'morning' THEN 'Add what you spent yesterday while you still remember it'
          ELSE 'What did you pay for today?'
        END,
        'waves://group/' || v_group.id::text || '/add-expense',
        jsonb_build_object('group', v_group.name, 'date', v_subject::text, 'slot', v_slot),
        'trip_nudge:' || v_group.id::text || ':' || v_subject::text || ':' || v_slot
          || ':' || v_member.profile_id::text
      );

      IF v_id IS NOT NULL THEN
        v_written := v_written + 1;
      END IF;
    END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_written;
END
$$;

REVOKE ALL ON FUNCTION public.waves_trip_nudges(p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_trip_nudges(p_now timestamp with time zone) TO service_role;

-- ────────────────────────────── settling up inside a group that is not there ──
--
-- A settlement left unanswered for a week is confirmed on the payer's behalf and
-- both people are told. In a deleted group that is two pushes about a payment
-- nobody can open, pointing at `waves://group/<id>`, plus a row written into the
-- dead group's feed. The join to `groups` was already there for the name; it now
-- also decides whether there is anything to confirm.
CREATE OR REPLACE FUNCTION public.waves_auto_confirm_settlements(p_now timestamp with time zone DEFAULT now(), p_window interval DEFAULT '7 days'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row     record;
  v_count   integer := 0;
  v_amount  text;
BEGIN
  FOR v_row IN
    SELECT s.id,
           s.group_id,
           s.amount,
           s.currency,
           s.from_member_id,
           s.to_member_id,
           g.name                AS group_name,
           payer.profile_id      AS payer_profile,
           -- A member is either a real profile or a ghost standing in for
           -- somebody who has not joined; the name lives in whichever it is.
           COALESCE(payer_profile.display_name, payer.ghost_name) AS payer_name,
           payee.profile_id      AS payee_profile,
           COALESCE(payee_profile.display_name, payee.ghost_name) AS payee_name
    FROM public.settlements s
    JOIN public.groups g            ON g.id = s.group_id AND g.deleted_at IS NULL
    JOIN public.group_members payer ON payer.id = s.from_member_id
    JOIN public.group_members payee ON payee.id = s.to_member_id
    LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.profile_id
    LEFT JOIN public.profiles payee_profile ON payee_profile.id = payee.profile_id
    WHERE s.status = 'initiated'
      AND s.initiated_at <= p_now - p_window
    -- Locked so two overlapping runs of the job cannot both claim the same
    -- settlement; the second simply finds nothing to do.
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.settlements
       SET status = 'auto_confirmed'
     WHERE id = v_row.id;

    INSERT INTO public.activity_log
      (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES
      (v_row.group_id, NULL, 'auto_confirmed', 'settlement', v_row.id,
       jsonb_build_object('amount', v_row.amount::text, 'currency', v_row.currency,
                          'reason', 'no_response_in_window'));

    v_amount := v_row.amount::text;

    -- Both people are told, and the wording differs because their positions
    -- do. The payee is the one who might want to dispute it.
    PERFORM public.waves_notify(
      v_row.payee_profile, v_row.group_id, 'settlement_confirmed',
      'Settled automatically',
      COALESCE(v_row.payer_name, 'Someone') || ' paid you, and nobody said otherwise for a week',
      'waves://group/' || v_row.group_id::text,
      jsonb_build_object('settlementId', v_row.id, 'amount', v_amount,
                         'currency', v_row.currency, 'role', 'payee',
                         'counterparty', v_row.payer_name, 'group', v_row.group_name),
      'auto_confirm:' || v_row.id::text || ':payee'
    );

    PERFORM public.waves_notify(
      v_row.payer_profile, v_row.group_id, 'settlement_confirmed',
      'Settled automatically',
      'Your payment to ' || COALESCE(v_row.payee_name, 'them') || ' was confirmed after a week',
      'waves://group/' || v_row.group_id::text,
      jsonb_build_object('settlementId', v_row.id, 'amount', v_amount,
                         'currency', v_row.currency, 'role', 'payer',
                         'counterparty', v_row.payee_name, 'group', v_row.group_name),
      'auto_confirm:' || v_row.id::text || ':payer'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.waves_auto_confirm_settlements(p_now timestamp with time zone, p_window interval) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_auto_confirm_settlements(p_now timestamp with time zone, p_window interval) TO service_role;

-- ═════════════ 4. the sweep that dragged dead groups back into sync ═════
--
-- Eighteen months of quiet archives a group. A deleted group is quiet by
-- definition, so the sweep would eventually stamp `archived_at` on one — and
-- that UPDATE fires `groups_stamp_seq`, which bumps `updated_seq` and pushes the
-- dead group, and the whole child set hanging off it, back through every
-- ex-member's next sync delta. Archiving something already deleted is also
-- simply meaningless: there is no dashboard left to take it off.
CREATE OR REPLACE FUNCTION public.waves_auto_archive_stale_groups(p_now timestamp with time zone DEFAULT now(), p_age interval DEFAULT '1 year 6 mons'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT g.id
      FROM public.groups g
     WHERE g.archived_at IS NULL
       AND g.deleted_at IS NULL
       -- The last thing anyone did here. GREATEST ignores NULL arguments, so a
       -- group with no expenses/settlements/activity falls back to its own
       -- creation time — which correctly leaves a brand-new empty group alone.
       AND GREATEST(
             g.created_at,
             (SELECT max(e.created_at) FROM public.expenses e     WHERE e.group_id = g.id),
             (SELECT max(s.created_at) FROM public.settlements s  WHERE s.group_id = g.id),
             (SELECT max(a.created_at) FROM public.activity_log a WHERE a.group_id = g.id)
           ) <= p_now - p_age
     -- Locked so two overlapping runs cannot both claim the same group; the
     -- second simply finds nothing to do.
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.groups
       SET archived_at = p_now
     WHERE id = v_row.id;

    -- A line in the feed so the archive is explained rather than mysterious.
    -- actor NULL = "the system did this", the same convention the auto-confirm
    -- job uses.
    INSERT INTO public.activity_log
      (group_id, actor_member_id, verb, object_type, object_id, payload)
    VALUES
      (v_row.id, NULL, 'auto_archived', 'group', v_row.id,
       jsonb_build_object('reason', 'inactive', 'after', p_age::text));

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.waves_auto_archive_stale_groups(p_now timestamp with time zone, p_age interval) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_auto_archive_stale_groups(p_now timestamp with time zone, p_age interval) TO service_role;

-- ═════════ 5. what deleting your account is said to cost you ════════════
--
-- The pre-deletion screen tells somebody how many groups they are in and warns
-- them if they still have money outstanding. Both numbers were read straight off
-- `group_members` with no idea whether the groups still existed, so an account
-- whose only unsettled balance was in a group deleted months ago was warned it
-- had an outstanding balance in INR — about a ledger that is gone, on the one
-- screen where somebody is deciding whether to go through with something
-- irreversible.
--
-- `left_at` is deliberately still not filtered here, which is a separate
-- question this migration does not answer: a group you left still holds the
-- expenses you wrote, so whether it belongs in "what you are about to lose" is a
-- product call, not a bug. Only the tombstone is fixed.
CREATE OR REPLACE FUNCTION public.waves_my_erasure_preview() RETURNS TABLE(groups_count bigint, expenses_authored bigint, settlements_involved bigint, outstanding_currencies text[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH me AS (
    SELECT gm.id
      FROM public.group_members gm
      JOIN public.groups g
        ON g.id = gm.group_id
       AND g.deleted_at IS NULL
     WHERE gm.profile_id = public.waves_current_profile_id()
  )
  SELECT
    (SELECT count(*) FROM me),
    (SELECT count(*) FROM public.expenses e
      WHERE e.created_by IN (SELECT id FROM me) AND e.deleted_at IS NULL),
    (SELECT count(*) FROM public.settlements s
      WHERE s.from_member_id IN (SELECT id FROM me)
         OR s.to_member_id IN (SELECT id FROM me)),
    COALESCE(
      (SELECT array_agg(DISTINCT b.currency::text)
         FROM public.group_balances b
        WHERE b.member_id IN (SELECT id FROM me) AND b.balance <> 0),
      ARRAY[]::text[]
    );
$$;

REVOKE ALL ON FUNCTION public.waves_my_erasure_preview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_my_erasure_preview() TO authenticated, service_role;

-- ═════════════ 6. a join link into a group that is not there ════════════
--
-- A durable group join link (A47) is a long-lived invite row, and consuming one
-- checked only the invite: not revoked, not expired, uses left. It never asked
-- about the group. So a QR code or a WhatsApp link for a group somebody has
-- since deleted still worked — it added the person to a group they will never
-- see, and if they were a guest it spent their one-group ceiling on it (ADR-006
-- addendum), which is the version of this that cannot be undone by the person it
-- happened to.
--
-- A refusal here surfaces exactly as a revoked invite already does, so the join
-- screen has nothing new to say.
CREATE OR REPLACE FUNCTION public.waves_consume_invite(p_invite_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE public.invites i
  SET use_count = use_count + 1
  WHERE i.id = p_invite_id
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
    AND i.use_count < i.max_uses
    AND EXISTS (
      SELECT 1 FROM public.groups g
       WHERE g.id = i.group_id
         AND g.deleted_at IS NULL
    )
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.waves_consume_invite(p_invite_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waves_consume_invite(p_invite_id uuid) TO service_role;
