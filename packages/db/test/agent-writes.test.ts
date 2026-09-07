/**
 * What an AI agent may write, and what it leaves behind.
 *
 * RLS decides whose data an agent can touch, and decides it well — it holds a
 * real person's token, so it sees what that person sees. These are the two
 * questions it does not answer, and both turn on one bit: a token minted for a
 * third-party client through Supabase's OAuth server carries `client_id`, and
 * the app's own token does not.
 *
 * The property that matters most here is the negative one. Every ceiling and
 * every audit row must be invisible to the app itself — a person tapping a
 * button is not an assistant, and a limit that leaked onto them would be a
 * silent refusal of their own money.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect } from './helpers.js';

let client: Client;
let profileId: string;

beforeAll(async () => {
  client = await connect();
  profileId = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Agent owner', 'INR')`,
    [profileId],
  );
});

afterAll(async () => {
  if (profileId) await client.query(`DELETE FROM profiles WHERE id = $1`, [profileId]);
  await client?.end();
});

/** Claims as the app mints them: a person, with no third-party client. */
const asApp = (sub: string) => ({ role: 'authenticated', sub });
/** Claims as Supabase's OAuth server mints them for somebody's assistant. */
const asAgent = (sub: string, clientId = 'desktop-assistant') => ({
  role: 'authenticated',
  sub,
  client_id: clientId,
});

describe('telling an agent from the app', () => {
  it('sees the client id an OAuth token carries', async () => {
    const found = await asRole(client, 'authenticated', asAgent(profileId), async () => {
      const result = await client.query(`SELECT waves_agent_client_id() AS id`);
      return result.rows[0].id;
    });
    expect(found).toBe('desktop-assistant');
  });

  it('sees nothing for the app, which is what makes all of this opt-in', async () => {
    const found = await asRole(client, 'authenticated', asApp(profileId), async () => {
      const result = await client.query(`SELECT waves_agent_client_id() AS id`);
      return result.rows[0].id;
    });
    expect(found).toBeNull();
  });
});

describe('the ceiling on a single expense', () => {
  it('refuses an agent write past the per-expense cap', async () => {
    await asRole(client, 'authenticated', asAgent(profileId), async () => {
      // The seeded cap is 5,000,000 minor units.
      await expect(
        client.query(`SELECT waves_assert_agent_cap($1::bigint)`, ['5000001']),
      ).rejects.toThrow(/AGENT_CAP_SINGLE/);
    });
  });

  it('allows one exactly at the cap, because a limit is a limit', async () => {
    await asRole(client, 'authenticated', asAgent(profileId), async () => {
      await expect(
        client.query(`SELECT waves_assert_agent_cap($1::bigint)`, ['5000000']),
      ).resolves.toBeTruthy();
    });
  });

  it('does not apply to the app, at any amount', async () => {
    await asRole(client, 'authenticated', asApp(profileId), async () => {
      await expect(
        client.query(`SELECT waves_assert_agent_cap($1::bigint)`, ['999999999']),
      ).resolves.toBeTruthy();
    });
  });
});

describe('the ceiling across a day', () => {
  it('counts what this person’s agents have already written', async () => {
    await asRole(client, 'authenticated', asAgent(profileId), async () => {
      // Four writes of 4,000,000 = 16,000,000 against a 20,000,000 daily cap.
      for (let index = 0; index < 4; index += 1) {
        await client.query(
          `SELECT waves_record_agent_write('expense.add', NULL, NULL, $1::bigint)`,
          ['4000000'],
        );
      }

      // 16,000,000 + 4,000,000 = 20,000,000 — exactly the cap, so allowed.
      await expect(
        client.query(`SELECT waves_assert_agent_cap($1::bigint)`, ['4000000']),
      ).resolves.toBeTruthy();

      // One unit more is the day's total exceeded, not this expense's size.
      await expect(
        client.query(`SELECT waves_assert_agent_cap($1::bigint)`, ['4000001']),
      ).rejects.toThrow(/AGENT_CAP_DAILY/);
    });
  });

  it('does not count the person’s own writes towards it', async () => {
    await asRole(client, 'authenticated', asApp(profileId), async () => {
      // The app writes nothing to the trail, so there is nothing to count.
      for (let index = 0; index < 10; index += 1) {
        await client.query(
          `SELECT waves_record_agent_write('expense.add', NULL, NULL, $1::bigint)`,
          ['9000000'],
        );
      }
      const count = await client.query(
        `SELECT count(*)::int AS n FROM agent_writes WHERE profile_id = $1`,
        [profileId],
      );
      expect(count.rows[0].n).toBe(0);
    });
  });
});

describe('the record of what an agent did', () => {
  it('stamps the client id from the token, not from the caller', async () => {
    const row = await asRole(
      client,
      'authenticated',
      asAgent(profileId, 'some-assistant'),
      async () => {
        const groupId = randomUUID();
        await client.query(
          `INSERT INTO groups (id, name, type, default_currency, created_by)
         VALUES ($1, 'Goa', 'trip', 'INR', $2)`,
          [groupId, profileId],
        );
        await client.query(
          `SELECT waves_record_agent_write('expense.add', $1::uuid, NULL, $2::bigint, 'INR')`,
          [groupId, '125000'],
        );
        const result = await client.query(
          `SELECT client_id, action, amount_minor, currency FROM agent_writes WHERE profile_id = $1`,
          [profileId],
        );
        return result.rows[0];
      },
    );

    expect(row.client_id).toBe('some-assistant');
    expect(row.action).toBe('expense.add');
    expect(String(row.amount_minor)).toBe('125000');
    expect(row.currency).toBe('INR');
  });

  it('is readable by the person it was made for', async () => {
    const rows = await asRole(client, 'authenticated', asAgent(profileId), async () => {
      await client.query(`SELECT waves_record_agent_write('settlement.record')`);
      const result = await client.query(`SELECT * FROM waves_my_agent_writes(10)`);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('settlement.record');
  });

  it('is not readable by anybody else', async () => {
    const other = randomUUID();
    await client.query(
      `INSERT INTO profiles (id, display_name, default_currency) VALUES ($1, 'Someone else', 'INR')`,
      [other],
    );
    try {
      const rows = await asRole(client, 'authenticated', asAgent(profileId), async () => {
        await client.query(`SELECT waves_record_agent_write('expense.add')`);
        // Same transaction, a different person asking.
        await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify(asAgent(other)),
        ]);
        const result = await client.query(`SELECT * FROM agent_writes`);
        return result.rows;
      });
      expect(rows).toHaveLength(0);
    } finally {
      await client.query(`DELETE FROM profiles WHERE id = $1`, [other]);
    }
  });

  it('cannot be forged: there is no way to insert a row directly', async () => {
    await asRole(client, 'authenticated', asAgent(profileId), async () => {
      // The point is that an agent cannot write a trail claiming a different
      // client, or quietly file no trail at all for what it just did.
      await expect(
        client.query(
          `INSERT INTO agent_writes (profile_id, client_id, action) VALUES ($1, 'pretending', 'expense.add')`,
          [profileId],
        ),
      ).rejects.toThrow();
    });
  });
});
