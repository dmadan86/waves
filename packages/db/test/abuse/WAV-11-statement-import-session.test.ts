/**
 * WAV-11 / L7: a statement continuation token proved the file was reserved and
 * nothing else, so one import id could read any number of chunks for an hour
 * against a single file use.
 *
 * Now waves_statement_import_chunk counts each request of an import id,
 * atomically, up to a ceiling.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from '../helpers';

let client: Client;
let a: string;

beforeAll(async () => {
  client = await connect();
  a = (await seedGroup(client, { memberCount: 1 })).profileIds[0]!;
});
afterAll(async () => {
  await client.query(`DELETE FROM profiles WHERE id = $1`, [a]).catch(() => null);
  await client.end();
});
beforeEach(async () => {
  await client.query(`DELETE FROM statement_import_sessions WHERE profile_id = $1`, [a]);
});

const chunk = async (c: Client, importId: string, max = 3) =>
  (await c.query(`SELECT waves_statement_import_chunk($1, $2, $3) AS r`, [a, importId, max]))
    .rows[0].r as { allowed: boolean; chunks: number; limit: number };

describe('WAV-11 one import id is a bounded number of requests', () => {
  it('counts each request and refuses past the ceiling', async () => {
    for (let i = 1; i <= 3; i += 1) {
      expect(await chunk(client, 'import-aaaa-0001')).toEqual({
        allowed: true,
        chunks: i,
        limit: 3,
      });
    }
    expect(await chunk(client, 'import-aaaa-0001')).toEqual({
      allowed: false,
      chunks: 3,
      limit: 3,
    });
    expect(await chunk(client, 'import-aaaa-0002')).toMatchObject({ allowed: true, chunks: 1 });
  });

  it('never lets a parallel burst past the ceiling', async () => {
    const other = await connect();
    try {
      const results = await Promise.all(
        [client, other, client, other, client, other].map((c) => chunk(c, 'import-bbbb-0001', 2)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(2);
    } finally {
      await other.end();
    }
  });

  it('rejects an import id that is not the shape the function accepts', async () => {
    await expect(chunk(client, 'bad id!')).rejects.toThrow(/statement_import_sessions_id_shape/);
  });

  it('is service-role only, table included', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await client.query(
        `SELECT has_function_privilege($1, 'public.waves_statement_import_chunk(uuid, text, integer)', 'EXECUTE') AS f,
                has_table_privilege($1, 'public.statement_import_sessions', 'SELECT') AS t`,
        [role],
      );
      expect(rows[0], role).toEqual({ f: false, t: false });
    }
  });
});
