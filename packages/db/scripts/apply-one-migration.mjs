/**
 * Apply a single migration file to the local test database.
 *
 * The suite in `packages/db/test` runs against a Postgres that already has the
 * schema; this is the one-liner for pushing a migration you are still writing
 * into it without rebuilding the whole database.
 *
 *   node packages/db/scripts/apply-one-migration.mjs packages/db/prisma/migrations/<dir>/migration.sql
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node packages/db/scripts/apply-one-migration.mjs <path to migration.sql>');
  process.exit(1);
}

const client = new pg.Client(
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54330/waves',
);
await client.connect();
try {
  await client.query(readFileSync(file, 'utf8'));
  console.log('applied', file);
} finally {
  await client.end();
}
