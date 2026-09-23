-- ---------------------------------------------------------------------------
-- Take SMS-derived drafts off the server.
--
-- SMS drafts now stay on the phone until they are used (apps/mobile
-- `lib/smsLocalDrafts.ts`). Before that, every draft made from a bank message
-- — read from the Android inbox or pasted — was a `captures` row, synced to
-- every device on the account with the amount, the shop, the day, the sender id
-- and the card's last digits in `parsed`. The app now does not write those
-- rows, and on upgrade the Android phone moves its unused ones back onto itself
-- and removes the server copies with the ordinary `capture.delete`.
--
-- What that leaves on the server, and what this script is for:
--
--   * open SMS captures of anybody who has not upgraded yet (or whose phone
--     never runs the move — an iPhone that pasted, a phone that was lost);
--   * the soft-deleted rows the move itself leaves behind — `capture.delete`
--     only stamps `deleted_at`, so the facts are still in the row.
--
-- It **scrubs and tombstones** every capture whose `parsed->>'source'` is
-- 'sms' and which was never turned into an expense (`status = 'open'`):
-- the facts are blanked, `parsed` is cut down to `{"source":"sms","scrubbed":
-- true}`, and `deleted_at` is set if it was not already. The UPDATE bumps
-- `updated_seq` (trigger `captures_stamp_seq`), so every device pulls the
-- tombstone and drops the draft from Review on its next sync.
--
-- Captures that became expenses (`status = 'assigned'`) are not touched: they
-- are the history of a spend that is now in a ledger.
--
-- Why not a hard DELETE: sync is pull-by-sequence. A row that vanishes never
-- reaches a device that already has it, and that device would show the draft
-- forever. The scrubbed tombstone is what tells it to let go. STEP 2 below can
-- remove the tombstones later, once every device has had time to pull them.
--
-- BEFORE RUNNING ON PROD: this needs the owner's go-ahead. An open SMS draft
-- that has not been moved yet is lost for good when scrubbed — the message is
-- still in the phone's inbox and on its Bank messages screen, but the draft in
-- Review goes. Best run some weeks after the release, when the upgraded phones
-- have done their move.
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

SELECT count(*)                                         AS sms_open_captures,
       count(*) FILTER (WHERE deleted_at IS NULL)       AS still_live,
       count(*) FILTER (WHERE deleted_at IS NOT NULL)   AS already_tombstoned,
       count(DISTINCT owner_user_id)                    AS owners
  FROM public.captures
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND status = 'open'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

-- For contrast: the ones that became expenses, which this script leaves alone.
SELECT count(*) AS sms_assigned_captures_untouched
  FROM public.captures
 WHERE parsed->>'source' = 'sms'
   AND status = 'assigned'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

-- ── STEP 1 — scrub and tombstone ───────────────────────────────────────────

UPDATE public.captures
   SET description   = '',
       category      = NULL,
       category_meta = NULL,
       amount        = 0,
       notes         = NULL,
       photo_path    = NULL,
       raw_text      = NULL,
       parsed        = '{"source":"sms","scrubbed":true}'::jsonb,
       payment_method = NULL,
       target_group_id = NULL,
       location      = NULL,
       deleted_at    = coalesce(deleted_at, now()),
       updated_at    = now()
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND status = 'open'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

-- ── count: after ───────────────────────────────────────────────────────────

SELECT count(*) AS sms_open_captures_left_unscrubbed
  FROM public.captures
 WHERE parsed->>'source' = 'sms'
   AND coalesce(parsed->>'scrubbed', 'false') <> 'true'
   AND status = 'open'
   AND (NULLIF(:'owner_id', '')::uuid IS NULL OR owner_user_id = NULLIF(:'owner_id', '')::uuid);

\if :apply
  COMMIT;
  \echo 'Applied: SMS captures scrubbed and tombstoned.'
\else
  ROLLBACK;
  \echo 'Dry run: rolled back. Nothing changed. Re-run with -v apply=1 to apply.'
\endif

-- ── STEP 2 — remove the tombstones (optional, weeks later) ─────────────────
--
-- Commented out on purpose. Only once every device has pulled the tombstones
-- above — a device that has not would keep the (already scrubbed) draft on
-- screen. Captures are not part of the append-only ledger, so no trigger
-- stands in the way.
--
-- BEGIN;
-- DELETE FROM public.captures
--  WHERE parsed->>'scrubbed' = 'true'
--    AND parsed->>'source' = 'sms'
--    AND status = 'open'
--    AND deleted_at < now() - interval '30 days';
-- COMMIT;
