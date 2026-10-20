/**
 * WAV-13: a refund decremented whichever bucket was current at refund time —
 * the new month after a UTC rollover, or the trial pool after an entitlement
 * change — not the one the reservation came from.
 *
 * Now the reservation answers name their month, and the refunds take it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup } from '../helpers';

let client: Client;
let a: string;
const NOW = new Date().toISOString().slice(0, 7);

beforeAll(async () => {
  client = await connect();
  a = (await seedGroup(client, { memberCount: 1 })).profileIds[0]!;
});
afterAll(async () => {
  await client.query(`DELETE FROM profiles WHERE id = $1`, [a]).catch(() => null);
  await client.end();
});
beforeEach(async () => {
  await client.query(`DELETE FROM voice_agent_usage WHERE profile_id = $1`, [a]);
  await client.query(`DELETE FROM ai_usage WHERE profile_id = $1`, [a]);
  await client.query(`DELETE FROM pro_trials WHERE profile_id = $1`, [a]);
});

const voiceCounts = async () =>
  (
    await client.query(
      `SELECT month, count FROM voice_agent_usage WHERE profile_id = $1 ORDER BY month`,
      [a],
    )
  ).rows as { month: string; count: number }[];

describe('WAV-13 refunds name their bucket', () => {
  it('a voice refund for an earlier month leaves the current month alone', async () => {
    await client.query(
      `INSERT INTO voice_agent_usage (profile_id, month, count) VALUES ($1, '2020-01', 5), ($1, $2, 2)`,
      [a, NOW],
    );
    const { rows } = await client.query(
      `SELECT waves_voice_agent_refund($1, '2020-01', false) AS n`,
      [a],
    );
    expect(rows[0].n).toBe(4);
    expect(await voiceCounts()).toEqual([
      { month: '2020-01', count: 4 },
      { month: NOW, count: 2 },
    ]);
  });

  it('a voice refund naming the trial pool touches only the pool', async () => {
    await client.query(
      `INSERT INTO pro_trials (profile_id, outcome, granted_at, expires_at, voice_used)
       VALUES ($1, 'granted', now(), now() + interval '15 days', 3)`,
      [a],
    );
    await client.query(
      `INSERT INTO voice_agent_usage (profile_id, month, count) VALUES ($1, $2, 2)`,
      [a, NOW],
    );
    const { rows } = await client.query(`SELECT waves_voice_agent_refund($1, $2, true) AS n`, [
      a,
      NOW,
    ]);
    expect(rows[0].n).toBe(2);
    expect(await voiceCounts()).toEqual([{ month: NOW, count: 2 }]);
  });

  it('the quota answers carry the month the reservation was taken in', async () => {
    const { rows } = await client.query(`SELECT waves_voice_agent_quota($1) AS q`, [a]);
    expect(rows[0].q).toMatchObject({ allowed: true, month: NOW });
    const ai = await client.query(
      `SELECT waves_ai_usage_reserve($1, 'screenshot_import', 5) AS q`,
      [a],
    );
    expect(ai.rows[0].q).toMatchObject({ allowed: true, month: NOW });
  });

  it('an ai_usage refund for an earlier month leaves the current month alone', async () => {
    await client.query(
      `INSERT INTO ai_usage (profile_id, month, feature, count)
       VALUES ($1, '2020-01', 'screenshot_import', 3), ($1, $2, 'screenshot_import', 1)`,
      [a, NOW],
    );
    const { rows } = await client.query(
      `SELECT waves_ai_usage_refund($1, 'screenshot_import', '2020-01') AS n`,
      [a],
    );
    expect(rows[0].n).toBe(2);
    const now = await client.query(
      `SELECT count FROM ai_usage WHERE profile_id = $1 AND month = $2 AND feature = 'screenshot_import'`,
      [a, NOW],
    );
    expect(now.rows[0].count).toBe(1);
  });

  it('leaves no overload of the refund functions behind', async () => {
    const { rows } = await client.query(
      `SELECT proname, pronargs FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('waves_voice_agent_refund', 'waves_ai_usage_refund')
        ORDER BY proname`,
    );
    expect(rows).toEqual([
      { proname: 'waves_ai_usage_refund', pronargs: 3 },
      { proname: 'waves_voice_agent_refund', pronargs: 3 },
    ]);
  });
});
