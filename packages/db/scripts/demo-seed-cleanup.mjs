// @ts-nocheck
/**
 * Undo for `seed-account.mjs`. Same thing `scripts/demo-seed-cleanup.sql` does,
 * runnable without psql on PATH — which on Windows is most of the time.
 *
 * It removes exactly the groups the seeder created — the marker in the name AND
 * the target account (SEED_TARGET_EMAIL) as `created_by` — and nothing else. No
 * profile, no auth user, no unmarked group, no other user's "[demo] …" group.
 *
 * Connection guards are the seeder's own (`seed-connection.mjs`): a remote host
 * needs SEED_ALLOW_REMOTE=1, production needs SEED_ALLOW_PROD=1 as well.
 *
 *   node packages/db/scripts/demo-seed-cleanup.mjs           # list, then tombstone
 *   node packages/db/scripts/demo-seed-cleanup.mjs --dry-run # list only
 *   node packages/db/scripts/demo-seed-cleanup.mjs --hard    # and delete the rows
 *   node packages/db/scripts/demo-seed-cleanup.mjs --restore # un-tombstone them
 *
 * The default is the app's own delete: it stamps `groups.deleted_at`, exactly
 * as `waves_delete_group` does. The groups leave every screen, drop out of
 * balances, and sync away from every device — and `--restore` brings them back.
 *
 * `--hard` really removes the rows. The ledger is append-only (ADR-004), so
 * four BEFORE DELETE triggers refuse the cascade; --hard disables those four
 * for the length of one transaction, which takes an ACCESS EXCLUSIVE lock on
 * four busy tables. Cheap on a quiet database, a brief outage on a loud one.
 * Prefer the default unless you specifically need the rows gone.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { openSeedClient } from './seed-connection.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '..', '.env'), quiet: true });

const CONNECTION_STRING = process.env.SEED_DATABASE_URL ?? process.env.DIRECT_URL;
const TARGET_EMAIL = (process.env.SEED_TARGET_EMAIL ?? 'apptest@gmail.com').toLowerCase();
const MARKER = process.env.SEED_MARKER ?? '[demo] ';
const LIKE = `${MARKER}%`;

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const HARD = ARGS.has('--hard');
const RESTORE = ARGS.has('--restore');

/** The four triggers that enforce append-only, and the tables they sit on. */
const APPEND_ONLY_TRIGGERS = [
  ['public.expenses', 'expenses_no_hard_delete'],
  ['public.expense_versions', 'expense_versions_append_only'],
  ['public.settlements', 'settlements_no_hard_delete'],
  ['public.activity_log', 'activity_log_append_only'],
];

async function main() {
  const { client, host } = await openSeedClient(CONNECTION_STRING, 'waves-demo-seed-cleanup');

  try {
    // A group counts as seeded only if it carries the marker AND the target
    // account created it. The marker alone would also match a real user's
    // group that happens to be called "[demo] …".
    const { rows: owners } = await client.query(
      `SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
        WHERE lower(u.email) = $1`,
      [TARGET_EMAIL],
    );
    if (owners.length === 0) throw new Error(`No profile for ${TARGET_EMAIL}.`);
    const owner = owners[0].id;

    const { rows } = await client.query(
      `SELECT g.id, g.name, g.default_currency, g.deleted_at,
              (SELECT count(*) FROM public.group_members m WHERE m.group_id = g.id) AS members,
              (SELECT count(*) FROM public.expenses e     WHERE e.group_id = g.id) AS expenses,
              (SELECT count(*) FROM public.settlements s  WHERE s.group_id = g.id) AS settlements
         FROM public.groups g
        WHERE g.name LIKE $1 AND g.created_by = $2
        ORDER BY g.created_at`,
      [LIKE, owner],
    );

    console.log(`host    ${host}`);
    console.log(`account ${TARGET_EMAIL}`);
    console.log(`marker  "${MARKER}"`);
    console.log(`\n${rows.length} group(s) match:`);
    for (const g of rows) {
      console.log(`  ${g.name}  ${g.id}`);
      console.log(
        `    ${g.default_currency} · ${g.members} members · ${g.expenses} expenses · ${g.settlements} settlements${g.deleted_at ? ' · already tombstoned' : ''}`,
      );
    }
    if (rows.length === 0) {
      console.log('\nNothing to do.');
      return;
    }

    if (DRY_RUN) {
      console.log('\n--dry-run: nothing written.');
      return;
    }

    if (RESTORE) {
      const restored = await client.query(
        `UPDATE public.groups SET deleted_at = NULL
          WHERE name LIKE $1 AND created_by = $2 AND deleted_at IS NOT NULL RETURNING id`,
        [LIKE, owner],
      );
      console.log(`\nRestored ${restored.rowCount} group(s).`);
      return;
    }

    await client.query('BEGIN');
    const tombstoned = await client.query(
      `UPDATE public.groups SET deleted_at = now()
        WHERE name LIKE $1 AND created_by = $2 AND deleted_at IS NULL RETURNING id`,
      [LIKE, owner],
    );
    await client.query('COMMIT');
    console.log(`\nTombstoned ${tombstoned.rowCount} group(s). They are off every screen now.`);

    if (HARD) {
      await client.query('BEGIN');
      try {
        for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
          await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        // One statement: groups cascades to members, expenses, versions,
        // payers, shares, settlements, both balance tables and activity_log.
        const deleted = await client.query(
          `DELETE FROM public.groups WHERE name LIKE $1 AND created_by = $2 RETURNING id`,
          [LIKE, owner],
        );
        for (const [table, trigger] of APPEND_ONLY_TRIGGERS) {
          await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
        await client.query('COMMIT');
        console.log(`Hard-deleted ${deleted.rowCount} group(s) and everything under them.`);
      } catch (error) {
        // The rollback also undoes the ALTERs, so the triggers are never left off.
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const left = await client.query(
      `SELECT count(*) FILTER (WHERE deleted_at IS NULL)     AS live,
              count(*) FILTER (WHERE deleted_at IS NOT NULL) AS tombstoned,
              count(*)                                       AS total
         FROM public.groups WHERE name LIKE $1 AND created_by = $2`,
      [LIKE, owner],
    );
    console.log(
      `\nRemaining: ${left.rows[0].total} marked group(s) — ${left.rows[0].live} live, ${left.rows[0].tombstoned} tombstoned.`,
    );

    // The triggers must be back on, whichever path we took.
    const on = await client.query(
      `SELECT c.relname AS table, t.tgname AS trigger, t.tgenabled
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = ANY($1)`,
      [APPEND_ONLY_TRIGGERS.map(([, name]) => name)],
    );
    const off = on.rows.filter((r) => r.tgenabled === 'D');
    console.log(
      off.length
        ? `\n  ✗ APPEND-ONLY TRIGGERS STILL DISABLED: ${off.map((r) => r.trigger).join(', ')} — re-enable them.`
        : '\n  ✓ all four append-only triggers enabled',
    );
    if (off.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    `\nCleanup failed — ${error?.code ? `${error.code}: ` : ''}${error?.message ?? error}`,
  );
  process.exit(1);
});
