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

import { addEqualSplitExpense, asRole, connect, seedGroup } from './helpers.js';

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

describe('settlements written by an agent', () => {
  it('caps and records a financer paying a rider back', async () => {
    const group = await seedGroup(client, { memberCount: 2, name: 'Airport cab' });
    const [financerProfile, riderProfile] = group.profileIds as [string, string];
    const [financer, rider] = group.memberIds as [string, string];

    await asRole(client, 'authenticated', asAgent(financerProfile, 'settlement-bot'), async () => {
      const mutationId = randomUUID();
      const { rows } = await client.query(
        `SELECT waves_record_settlement($1, $2, $3, 7000, 'upi', 'INR', NULL, '[]'::jsonb, $4) AS id`,
        [group.groupId, financer, rider, mutationId],
      );
      expect(rows[0].id).toBeTruthy();

      const audit = await client.query(
        `SELECT client_id, action, group_id, object_id, amount_minor, currency
           FROM agent_writes WHERE profile_id = $1`,
        [financerProfile],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        client_id: 'settlement-bot',
        action: 'settlement.record',
        group_id: group.groupId,
        object_id: rows[0].id,
        currency: 'INR',
      });
      expect(String(audit.rows[0].amount_minor)).toBe('7000');
    });

    await asRole(client, 'authenticated', asAgent(riderProfile), async () => {
      const audit = await client.query(`SELECT * FROM agent_writes`);
      expect(audit.rows).toHaveLength(0);
    });
  });

  it('refuses an agent settlement over the cap', async () => {
    const group = await seedGroup(client, { memberCount: 2, name: 'Over cap cab' });
    const [financerProfile] = group.profileIds as [string, string];
    const [financer, rider] = group.memberIds as [string, string];

    await asRole(client, 'authenticated', asAgent(financerProfile), async () => {
      await expect(
        client.query(
          `SELECT waves_record_settlement($1, $2, $3, 5000001, 'upi', 'INR', NULL, '[]'::jsonb, $4)`,
          [group.groupId, financer, rider, randomUUID()],
        ),
      ).rejects.toThrow(/AGENT_CAP_SINGLE/);
    });
  });

  it('does not count a replayed agent settlement twice', async () => {
    const group = await seedGroup(client, { memberCount: 2, name: 'Replay cab' });
    const [financerProfile] = group.profileIds as [string, string];
    const [financer, rider] = group.memberIds as [string, string];

    await asRole(client, 'authenticated', asAgent(financerProfile), async () => {
      const mutationId = randomUUID();
      const first = await client.query(
        `SELECT waves_record_settlement($1, $2, $3, 4000, 'upi', 'INR', NULL, '[]'::jsonb, $4) AS id`,
        [group.groupId, financer, rider, mutationId],
      );
      const second = await client.query(
        `SELECT waves_record_settlement($1, $2, $3, 4000, 'upi', 'INR', NULL, '[]'::jsonb, $4) AS id`,
        [group.groupId, financer, rider, mutationId],
      );
      expect(second.rows[0].id).toBe(first.rows[0].id);

      const audit = await client.query(
        `SELECT count(*)::int AS n, coalesce(sum(amount_minor), 0)::text AS total
           FROM agent_writes WHERE profile_id = $1 AND action = 'settlement.record'`,
        [financerProfile],
      );
      expect(audit.rows[0]).toMatchObject({ n: 1, total: '4000' });
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
        // The group insert files its own `group.create` row; this is about
        // the one written by hand.
        const result = await client.query(
          `SELECT client_id, action, amount_minor, currency FROM agent_writes
            WHERE profile_id = $1 AND action = 'expense.add'`,
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

describe('the writes that move no money', () => {
  /** Every audit row this person has, oldest first, as `action` strings. */
  const trail = async (
    profile: string,
  ): Promise<
    { action: string; group_id: string; object_id: string; amount_minor: string | null }[]
  > => {
    const { rows } = await client.query(
      `SELECT action, group_id, object_id, amount_minor FROM agent_writes
        WHERE profile_id = $1 ORDER BY created_at, action`,
      [profile],
    );
    return rows;
  };

  it('records a group an agent creates, and not the creator joining it', async () => {
    await asRole(client, 'authenticated', asAgent(profileId), async () => {
      const { rows } = await client.query(
        `SELECT waves_create_group('Goa', 'trip', 'INR', NULL, true, NULL, NULL) AS id`,
      );
      const groupId = String(rows[0].id);
      expect(await trail(profileId)).toEqual([
        { action: 'group.create', group_id: groupId, object_id: groupId, amount_minor: null },
      ]);
    });
  });

  it('records each person an agent adds as a ghost', async () => {
    const group = await seedGroup(client, { memberCount: 1, name: 'Flat' });
    const [owner] = group.profileIds as [string];

    await asRole(client, 'authenticated', asAgent(owner), async () => {
      const { rows } = await client.query(`SELECT waves_add_ghost_member($1, 'Raj') AS id`, [
        group.groupId,
      ]);
      expect(await trail(owner)).toEqual([
        {
          action: 'member.add',
          group_id: group.groupId,
          object_id: rows[0].id,
          amount_minor: null,
        },
      ]);
    });
  });

  it('records a delete and a restore, and neither counts towards the daily cap', async () => {
    const group = await seedGroup(client, { memberCount: 2, name: 'Dinner club' });
    const [owner] = group.profileIds as [string, string];
    const [payer, other] = group.memberIds as [string, string];
    const { expenseId } = await addEqualSplitExpense(client, {
      groupId: group.groupId,
      payers: { [payer]: 400000n },
      participants: [payer, other],
      amount: 400000n,
    });

    await asRole(client, 'authenticated', asAgent(owner), async () => {
      await client.query(`SELECT waves_delete_expense($1)`, [expenseId]);
      await client.query(`SELECT waves_restore_expense($1)`, [expenseId]);

      expect(
        (await trail(owner)).map((row) => [row.action, row.object_id, row.amount_minor]),
      ).toEqual([
        ['expense.delete', expenseId, null],
        ['expense.restore', expenseId, null],
      ]);
      // A whole day's allowance is still there: tidying up is not spending.
      await expect(
        client.query(`SELECT waves_assert_agent_cap($1::bigint)`, ['5000000']),
      ).resolves.toBeTruthy();
    });
  });

  it('records a join link the first time it is minted, and not when it is handed back', async () => {
    const group = await seedGroup(client, { memberCount: 1, name: 'Book club' });
    const [owner] = group.profileIds as [string];

    await asRole(client, 'authenticated', asAgent(owner), async () => {
      await client.query(`SELECT waves_ensure_group_join_token($1)`, [group.groupId]);
      await client.query(`SELECT waves_ensure_group_join_token($1)`, [group.groupId]);
      expect((await trail(owner)).map((row) => row.action)).toEqual(['invite.create']);
    });
  });

  it('records none of it for the app', async () => {
    const group = await seedGroup(client, { memberCount: 1, name: 'Own hands' });
    const [owner] = group.profileIds as [string];

    await asRole(client, 'authenticated', asApp(owner), async () => {
      await client.query(
        `SELECT waves_create_group('Mine', 'trip', 'INR', NULL, true, NULL, NULL)`,
      );
      await client.query(`SELECT waves_add_ghost_member($1, 'Priya')`, [group.groupId]);
      await client.query(`SELECT waves_ensure_group_join_token($1)`, [group.groupId]);
      expect(await trail(owner)).toEqual([]);
    });
  });
});
