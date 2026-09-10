-- Any member could delete anybody's group, and nothing recorded who did.
--
-- `waves_delete_group` checks `is_group_admin` before it stamps the tombstone,
-- and the client only shows the button to an admin. Neither is the boundary,
-- because the RPC is not the only door to the column.
--
-- `authenticated` holds a table-wide `GRANT SELECT, INSERT, UPDATE ON
-- public.groups` (baseline, re-granted by 20260904160000_anon_surface_on_hosted),
-- the `groups_update` RLS policy scopes that UPDATE with `is_group_member(id)` —
-- the row, not the columns — and there are no column-level ACLs anywhere in this
-- schema. So the only thing standing between "a member may edit this group" and
-- "a member may edit *this column*" is `waves_guard_group_columns`, a
-- hand-maintained list of forbidden columns. `deleted_at` was not on it.
--
-- Any ordinary member could therefore send PostgREST a plain
--
--     PATCH /rest/v1/groups?id=eq.<id>   {"deleted_at": "2026-09-10T00:00:00Z"}
--
-- and delete the group for everybody without being an admin — or send
-- `{"deleted_at": null}` and resurrect one an admin had deleted. Worse than
-- accepted: the write fires `groups_stamp_seq`, so a forged delete is broadcast
-- to every member's mirror and the group vanishes off all their devices.
-- `/sync` was never the hole — its `GROUP_UPDATABLE_FIELDS` whitelist correctly
-- omits `deleted_at` — but a whitelist in an edge function cannot defend a grant
-- in the database.
--
-- Guests sign in as `authenticated` and are ordinary members, so this was
-- reachable by anybody who had been let into a group at all.
--
-- ─────────────────────────────────────────── it was not the only omission ──
--
-- `budget_minor` and `budget_currency` have exactly the same shape:
-- `waves_set_group_budget` refuses a non-admin with NOT_AN_ADMIN, the two
-- columns are absent from the `/sync` whitelist, and they were absent from the
-- guard — so a direct PATCH set or wiped a group's overall budget with no admin
-- check at all. The guard already protected the sibling `category_budgets`. Two
-- hand-maintained lists that have now drifted apart twice is not a list problem,
-- it is the wrong shape of list.
--
-- So this stops enumerating what is forbidden and enumerates what is allowed:
-- exactly the columns `/sync` already lets a member write, and nothing else. A
-- column added to `public.groups` next year is refused by default rather than
-- exposed by default, which is the only version of this trigger that stays
-- correct without somebody remembering it exists.
--
-- What that deliberately keeps writable:
--
--   * `archived_at` — this is *not* the same bug. It is in the `/sync`
--     whitelist, so any member archiving a group for everyone is the shipped,
--     intended capability and the app's own archive button is an ordinary
--     `group.update`. Whether archiving should be admin-only is a real product
--     question, and it is not one to settle inside a security fix by breaking
--     the button.
--   * name, type, cover emoji, photo path, simplify_debts, default currency,
--     country code, the trip dates, the time zone and the three reminder
--     settings — ordinary editable fields the app already writes directly
--     (`updateGroup` in the mobile client and in `@waves/api-client`, and
--     `PATCH /v1/groups/:id` in the developer API, all send only these).
--
-- And what it now refuses that it did not name before: `updated_at`, which no
-- caller sends and which is self-reported anyway; `deleted_at`; `budget_minor`;
-- `budget_currency`. The four columns it did name — `updated_seq`, `created_by`,
-- `id`, `created_at` — are refused by the same rule instead of by four `IF`s.
--
-- The `photo_path` paid gate is not a "may this column be written" rule but a
-- "may *you* write it" rule, so it stays as its own check after the allowlist.
--
-- ─────────────────────────────────────────────── two mechanical footnotes ──
--
-- The guard runs only for `anon` and `authenticated`, so the definer RPCs that
-- legitimately write these columns — `waves_delete_group`,
-- `waves_set_group_budget`, `waves_set_group_fx_rate` and the join-token
-- functions — execute as their owner and pass straight through, exactly as they
-- did before.
--
-- Trigger order matters and is load-bearing: `groups_guard_columns` sorts before
-- `groups_stamp_seq`, so the guard sees `NEW.updated_seq` still equal to
-- `OLD.updated_seq` on an ordinary member's write, and the stamp bumps it
-- afterwards. That is why `updated_seq` can be refused outright here without
-- rejecting every legitimate update.
--
-- `waves_guard_membership_columns` is deliberately left alone. Its three entries
-- look like the same drift and are not: on `group_members` the stamp trigger
-- assigns `updated_seq` unconditionally, so a client's value is discarded rather
-- than needing to be refused. The asymmetry is real and correct.

CREATE OR REPLACE FUNCTION public.waves_guard_group_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  -- Kept in step with `GROUP_UPDATABLE_FIELDS` in supabase/functions/sync/index.ts.
  -- These are the same list, and this one is the authority: `/sync` is a
  -- convenience filter that returns a tidy 400, the trigger is the boundary that
  -- holds when somebody skips `/sync` entirely.
  v_allowed constant text[] := ARRAY[
    'name',
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

-- ─────────────────────────────────── who deleted this, and when, and why ──
--
-- `waves_delete_group` has never written anything down. The tombstone records
-- that a group was deleted and the instant it happened; it records nobody. Which
-- means an admin's legitimate delete and the forged PATCH above are, in the data
-- that survives, the same event — and there is no way to go back through
-- production afterwards and tell which groups were deleted by somebody who had
-- no right to.
--
-- That is worth fixing on its own terms and not only as forensics for this bug.
-- Deleting a group destroys the record of who owed whom for every member, not
-- just for the one who tapped the button; it is the most consequential thing one
-- person can do to everybody else's copy of the app, and it was the only such
-- action leaving no line in the feed. `waves_auto_archive_stale_groups` and
-- `waves_auto_confirm_settlements` both already write one for far smaller
-- things.
--
-- The row is written before the tombstone, inside the same transaction and under
-- the same `FOR UPDATE` lock, so either both land or neither does. `actor_member_id`
-- is the caller's own membership, which is what makes it an audit row rather than
-- a timestamp — and it stays non-null because the admin gate above has already
-- established that the caller is a member.
--
-- Everything else is 20260907160000_admin_deletes_unsettled_group verbatim: same
-- signature, same void return (so `CREATE OR REPLACE` is enough and there is no
-- 42P13 to drop around), same lock, same admin gate, same idempotent re-delete —
-- and the idempotency is why the row goes after that check and not before, so a
-- retried offline queue flush does not write a second line for the same delete.
CREATE OR REPLACE FUNCTION public.waves_delete_group(p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_profile_id uuid := public.waves_current_profile_id();
  v_deleted_at timestamptz;
  v_actor      uuid;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in to delete a group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the group row up front (FOR UPDATE), so the read of `deleted_at` and
  -- the tombstone that follows see the same serialized view of the row. This
  -- closes the delete-vs-delete window and gives a single coordination point a
  -- balance-mutating writer can share (take the same row lock) to be serialized
  -- against a delete; on its own it does not stop a writer that never locks
  -- this row (see A49 review notes).
  SELECT deleted_at INTO v_deleted_at FROM public.groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no such group' USING ERRCODE = 'no_data_found';
  END IF;

  -- Only an admin/owner may delete the group for everyone. The button hides for
  -- everyone else, but the client gate is a courtesy — this is the boundary.
  IF NOT public.is_group_admin(p_group_id) THEN
    RAISE EXCEPTION 'NOT_ADMIN: only an admin deletes a group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent: deleting an already-deleted group is a no-op, so a retried queue
  -- flush or a second tap lands cleanly rather than raising. Checked after the
  -- admin gate so a re-delete still answers a non-admin with NOT_ADMIN.
  IF v_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  v_actor := public.waves_my_member_id_for(p_group_id, v_profile_id);

  INSERT INTO public.activity_log
    (group_id, actor_member_id, verb, object_type, object_id, payload)
  SELECT p_group_id, v_actor, 'group_deleted', 'group', p_group_id,
         jsonb_build_object('name', g.name)
    FROM public.groups g
   WHERE g.id = p_group_id;

  -- The tombstone. The stamp trigger bumps `updated_seq`, so the change reaches
  -- every member's mirror on their next sync and the group leaves all their lists.
  UPDATE public.groups SET deleted_at = now() WHERE id = p_group_id;
END
$$;

-- CREATE OR REPLACE keeps the ACL the baseline set, so nothing is actually
-- open here. The grants are restated anyway because that is the rule the
-- repository enforces on every SECURITY DEFINER function: such a function
-- bypasses RLS and Postgres grants EXECUTE to PUBLIC by default, so a
-- migration that stays silent about its caller model is one signature change
-- away from minting a *new* function with the default back on — which is
-- exactly how waves_consume_invite once regained anon. Saying it in the same
-- file makes the intent survive the next edit.
REVOKE ALL ON FUNCTION public.waves_delete_group(p_group_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.waves_delete_group(p_group_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.waves_delete_group(p_group_id uuid) TO service_role;
