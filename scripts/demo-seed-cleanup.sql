-- ---------------------------------------------------------------------------
-- Undo for `packages/db/scripts/seed-account.mjs`.
--
-- Removes exactly the groups that seeder created and nothing else. It finds
-- them by the marker in their name (default "[demo] ") — set :marker below if
-- the seed ran with a different SEED_MARKER.
--
-- It touches no row that was not created by the seed run: no profile, no auth
-- user, no group without the marker, and nothing belonging to anybody else.
-- The ghosts, expenses, versions, payers, shares, settlements, balances and
-- activity rows all hang off the group, so removing the group removes them.
--
-- ── two ways to run it, and which one you want ────────────────────────────
--
-- STEP 1 (soft) is the app's own delete: it stamps `groups.deleted_at`, which
-- is exactly what `waves_delete_group` does when somebody taps Delete group.
-- The groups vanish from every screen, drop out of balances, and sync away
-- from every device. It takes no heavy lock and it is reversible — set
-- `deleted_at` back to NULL and they return. **This is the one to run.**
--
-- STEP 2 (hard) actually removes the rows. It is optional and it is not free:
-- the ledger is append-only by design, so `expenses`, `expense_versions`,
-- `settlements` and `activity_log` all carry BEFORE DELETE triggers that
-- refuse the delete (ADR-004), and a cascade from `groups` fires them. The only
-- way through is to disable those four triggers for the length of the
-- transaction, which takes an ACCESS EXCLUSIVE lock on four busy tables. On a
-- live database that is a short outage for every reader of those tables. Run it
-- when the database is quiet, or do not run it at all — step 1 already gives
-- you back the account you had.
--
-- ── running it ─────────────────────────────────────────────────────────────
--
--   psql "$DIRECT_URL" -v marker='[demo] %' -f scripts/demo-seed-cleanup.sql
--
-- or from the repo, which needs no psql on PATH:
--
--   node packages/db/scripts/demo-seed-cleanup.mjs           # step 1, soft
--   node packages/db/scripts/demo-seed-cleanup.mjs --hard    # steps 1 and 2
--
-- Both start by printing what they are about to remove. Read that first.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?marker} \else \set marker '[demo] %' \endif

-- ── what is about to go ────────────────────────────────────────────────────

SELECT g.id,
       g.name,
       g.default_currency,
       g.deleted_at,
       (SELECT count(*) FROM public.group_members m WHERE m.group_id = g.id) AS members,
       (SELECT count(*) FROM public.expenses e     WHERE e.group_id = g.id) AS expenses,
       (SELECT count(*) FROM public.settlements s  WHERE s.group_id = g.id) AS settlements
  FROM public.groups g
 WHERE g.name LIKE :'marker'
 ORDER BY g.created_at;

-- ── STEP 1 — the soft delete (the app's own) ───────────────────────────────

BEGIN;

UPDATE public.groups
   SET deleted_at = now()
 WHERE name LIKE :'marker'
   AND deleted_at IS NULL;

-- Proof: no seeded group is live any more, and no seeded balance is counted.
SELECT count(*) AS still_live
  FROM public.groups
 WHERE name LIKE :'marker' AND deleted_at IS NULL;

COMMIT;

-- ── STEP 2 — the hard delete (optional; read the note at the top) ──────────
--
-- Everything below is commented out on purpose. Uncomment the whole block only
-- if you want the rows gone rather than tombstoned, and only when the database
-- is quiet enough to give up four table locks for a few seconds.

-- BEGIN;
--
-- -- ADR-004 forbids deleting a ledger row. These four triggers are what enforce
-- -- it, and a cascade from `groups` runs straight into them. Disabled here for
-- -- the length of this transaction and no longer; the transaction either
-- -- commits with them back on or rolls back with them never having changed.
-- ALTER TABLE public.expenses         DISABLE TRIGGER expenses_no_hard_delete;
-- ALTER TABLE public.expense_versions DISABLE TRIGGER expense_versions_append_only;
-- ALTER TABLE public.settlements      DISABLE TRIGGER settlements_no_hard_delete;
-- ALTER TABLE public.activity_log     DISABLE TRIGGER activity_log_append_only;
--
-- -- One statement. `groups` cascades to group_members, expenses,
-- -- expense_versions, expense_payers, expense_shares, settlements,
-- -- group_balances, pairwise_balances and activity_log.
-- DELETE FROM public.groups WHERE name LIKE :'marker';
--
-- ALTER TABLE public.expenses         ENABLE TRIGGER expenses_no_hard_delete;
-- ALTER TABLE public.expense_versions ENABLE TRIGGER expense_versions_append_only;
-- ALTER TABLE public.settlements      ENABLE TRIGGER settlements_no_hard_delete;
-- ALTER TABLE public.activity_log     ENABLE TRIGGER activity_log_append_only;
--
-- COMMIT;

-- ── what is left ───────────────────────────────────────────────────────────

SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS live,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS tombstoned,
       count(*) AS total
  FROM public.groups
 WHERE name LIKE :'marker';
