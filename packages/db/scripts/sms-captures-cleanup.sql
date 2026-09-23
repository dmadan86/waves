-- ---------------------------------------------------------------------------
-- Take what bank messages left on the server off it.
--
-- SMS drafts now stay on the phone until they are used (apps/mobile
-- `lib/smsLocalDrafts.ts`). Before that, every draft made from a bank message
-- — read from the Android inbox or pasted — was a `captures` row, synced to
-- every device on the account with the amount, the shop, the day, the bank's
-- sender id and the card's last digits in `parsed`. Current app builds do not
-- write those rows, the sync function acknowledges and drops them from older
-- builds, and on upgrade each Android phone moves the unused drafts *it* read
-- back onto itself and queues the ordinary `capture.delete` for them.
--
-- `capture.delete` only sets `deleted_at`. The row — every fact in it — stays
-- on the server, and in every other device's mirror, until this script runs.
-- The leak is not closed server-side until it has been applied.
--
-- What this script does, to every capture whose `parsed->>'source'` is 'sms'
-- (optionally for one account), in one transaction:
--
--   * OPEN rows (never turned into an expense — live, or deleted by the move,
--     or dismissed): scrubbed and tombstoned. description, category,
--     category_meta, notes, raw_text, photo_path, payment_method,
--     target_group_id and location go to NULL or empty; amount to 0;
--     expense_date to 1970-01-01; currency to 'XXX' (ISO 4217 "no currency");
--     parsed to {"source":"sms","scrubbed":true}; deleted_at is set if it was
--     not already.
--   * ASSIGNED rows (already turned into an expense): the expense in the group
--     is the record of that spend and is not touched, and neither is the
--     capture's status or assigned_group_id / assigned_expense_id. Only what
--     came from the message goes: raw_text to NULL and parsed to
--     {"source":"sms","scrubbed":true} — the sender id, card tail and dedupe
--     key.
--
-- Every UPDATE bumps `updated_seq` (trigger `captures_stamp_seq`), so each
-- device pulls the scrubbed row on its next sync and its mirror copy is
-- overwritten; open rows leave Review. It is idempotent: rows already marked
-- `scrubbed` are skipped.
--
-- Why not a hard DELETE: sync is pull-by-sequence. A row that vanishes never
-- reaches a device that already has it, and that device would keep the full
-- row in its mirror forever. The scrubbed tombstone is what overwrites it.
-- STEP 2 below can remove the tombstones later.
--
-- Photos: an SMS draft is not normally given a photo, but one edited on the
-- capture form could have been. Blanking photo_path orphans that object in the
-- `captures` bucket (Cloudflare R2 / storage). The count below lists them
-- first; remove those objects separately if any are reported.
--
-- BEFORE RUNNING ON PROD: this needs the owner's go-ahead. An open SMS draft
-- a phone has not moved yet is lost for good when scrubbed (its message is
-- still in that phone's inbox, and on its Bank messages screen, so the next
-- scan there re-drafts it on the device). Best run once the release has been
-- out long enough for upgraded phones to have done their move.
--
-- ── running it ─────────────────────────────────────────────────────────────
--
--   # dry run (the default): prints the counts, changes nothing
--   psql "$DIRECT_URL" -f packages/db/scripts/sms-captures-cleanup.sql
--
--   # one account only
--   psql "$DIRECT_URL" -v owner='someone@example.com' -f packages/db/scripts/sms-captures-cleanup.sql
--
--   # for real — add -v apply=1 to either of the above
--   psql "$DIRECT_URL" -v apply=1 -f packages/db/scripts/sms-captures-cleanup.sql
--
-- Without `owner` it covers every account. Without `apply=1` the transaction
-- is rolled back at the end, so the "after" counts show what would happen.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?apply} \else \set apply 0 \endif
\if :{?owner}
  -- One account. No such account → no owner_id, so the next query fails and
  -- ON_ERROR_STOP halts before anything is touched.
  SELECT p.id AS owner_id
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE lower(u.email) = lower(:'owner') \gset
\else
  -- Every account. An empty string, not NULL — `\gset` unsets a variable for
  -- a NULL column — and `NULLIF(:'owner_id', '')` below turns it into "any".
  SELECT '' AS owner_id \gset
\endif

BEGIN;

-- ── count: what is about to be scrubbed ────────────────────────────────────

SELECT status,
       count(*)                                         AS rows,
       count(*) FILTER (WHERE deleted_at IS NULL)       AS live,
       count(*) FILTER (WHERE deleted_at IS NOT NULL)   AS tombstoned,
       count(*) FILTER (WHERE photo_path IS NOT NULL)   AS with_photo,
       count(DISTINCT owner_user_id)                    AS owners
  FROM public.captures
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid)
 GROUP BY status
 ORDER BY status;

-- The photo objects blanking photo_path will orphan (open rows only; an
-- assigned row keeps its photo_path).
SELECT id, owner_user_id, photo_path
  FROM public.captures
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND status = 'open'
   AND photo_path IS NOT NULL
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

-- ── STEP 1a — open rows: scrub and tombstone ───────────────────────────────

UPDATE public.captures
   SET description     = '',
       category        = NULL,
       category_meta   = NULL,
       expense_date    = DATE '1970-01-01',
       currency        = 'XXX',
       amount          = 0,
       notes           = NULL,
       photo_path      = NULL,
       raw_text        = NULL,
       parsed          = '{"source":"sms","scrubbed":true}'::jsonb,
       payment_method  = NULL,
       target_group_id = NULL,
       location        = NULL,
       deleted_at      = coalesce(deleted_at, now()),
       updated_at      = now()
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND status = 'open'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

-- ── STEP 1b — assigned rows: drop what came from the message ───────────────

UPDATE public.captures
   SET raw_text   = NULL,
       parsed     = '{"source":"sms","scrubbed":true}'::jsonb,
       updated_at = now()
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND status = 'assigned'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

-- ── count: after (should be zero for both statuses) ────────────────────────

SELECT status, count(*) AS left_unscrubbed
  FROM public.captures
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid)
 GROUP BY status;

\if :apply
  COMMIT;
  \echo 'Applied: SMS captures scrubbed.'
\else
  ROLLBACK;
  \echo 'Dry run: rolled back. Nothing changed. Re-run with -v apply=1 to apply.'
\endif

-- ── STEP 2 — remove the open tombstones (optional, weeks later) ────────────
--
-- Commented out on purpose. Only once every device has pulled the scrubbed
-- rows above — a device that has not would keep its full, unscrubbed copy.
-- Captures are not part of the append-only ledger, so no trigger stands in
-- the way. Assigned rows are kept: they link a capture to its expense.
--
-- BEGIN;
-- DELETE FROM public.captures
--  WHERE parsed->>'scrubbed' = 'true'
--    AND parsed->>'source' = 'sms'
--    AND status = 'open'
--    AND deleted_at < now() - interval '30 days';
-- COMMIT;
