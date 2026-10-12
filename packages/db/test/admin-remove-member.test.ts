/**
 * An admin removes a person from a group.
 *
 * Removal is leaving done to somebody else: `left_at` is stamped, the ledger is
 * untouched, and the person stops being able to see the group. What is pinned
 * here is the shape of that — the admin gate, the two refusals (yourself, and
 * somebody already gone), history that stays, access that goes, a placeholder
 * that can be removed, and the one-line notice the removed person gets.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, expectDenied, readBalances, seedGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const leftAt = async (memberId: string): Promise<unknown> => {
  const { rows } = await client.query(`SELECT left_at FROM group_members WHERE id = $1`, [
    memberId,
  ]);
  return rows[0].left_at;
};

describe('an admin removes a member', () => {
  it('stamps left_at and keeps every expense, share and balance', async () => {
    const g = await seedGroup(client, { memberCount: 3 });
    const [admin, target, other] = g.memberIds as [string, string, string];
    const { versionId } = await addEqualSplitExpense(client, {
      groupId: g.groupId,
      payers: { [admin]: 3000n },
      participants: [admin, target, other],
      amount: 3000n,
    });
    const before = await readBalances(client, g.groupId);

    await as(g.profileIds[0] as string, async () => {
      await client.query(`SELECT waves_remove_member($1)`, [target]);
    });

    expect(await leftAt(target)).not.toBeNull();
    const { rows: shares } = await client.query(
      `SELECT 1 FROM expense_shares WHERE expense_version_id = $1 AND member_id = $2`,
      [versionId, target],
    );
    expect(shares).toHaveLength(1);
    // The removed person still owes their third: history and balances stay.
    const after = await readBalances(client, g.groupId);
    expect(after.get(target)).toBe(-1000n);
    expect(after).toEqual(before);
  });

  it('refuses a non-admin', async () => {
    const g = await seedGroup(client, { memberCount: 3 });
    await as(g.profileIds[1] as string, async () => {
      const message = await expectDenied(
        client.query(`SELECT waves_remove_member($1)`, [g.memberIds[2]]),
      );
      expect(message).toMatch(/NOT_ADMIN/);
    });
    expect(await leftAt(g.memberIds[2] as string)).toBeNull();
  });

  it('refuses an admin of some other group', async () => {
    const mine = await seedGroup(client, { memberCount: 2 });
    const theirs = await seedGroup(client, { memberCount: 2 });
    await as(mine.profileIds[0] as string, async () => {
      const message = await expectDenied(
        client.query(`SELECT waves_remove_member($1)`, [theirs.memberIds[1]]),
      );
      expect(message).toMatch(/NOT_ADMIN/);
    });
  });

  it('refuses removing yourself — that is Leave group', async () => {
    const g = await seedGroup(client, { memberCount: 2 });
    await as(g.profileIds[0] as string, async () => {
      const message = await expectDenied(
        client.query(`SELECT waves_remove_member($1)`, [g.memberIds[0]]),
      );
      expect(message).toMatch(/CANNOT_REMOVE_SELF/);
    });
    expect(await leftAt(g.memberIds[0] as string)).toBeNull();
  });

  it('refuses someone who is already gone', async () => {
    const g = await seedGroup(client, { memberCount: 2 });
    await as(g.profileIds[0] as string, async () => {
      await client.query(`SELECT waves_remove_member($1)`, [g.memberIds[1]]);
      const message = await expectDenied(
        client.query(`SELECT waves_remove_member($1)`, [g.memberIds[1]]),
      );
      expect(message).toMatch(/NOT_A_MEMBER/);
    });
  });

  it('refuses a member that does not exist', async () => {
    const g = await seedGroup(client, { memberCount: 1 });
    await as(g.profileIds[0] as string, async () => {
      const message = await expectDenied(
        client.query(`SELECT waves_remove_member(gen_random_uuid())`),
      );
      expect(message).toMatch(/NOT_FOUND/);
    });
  });

  it('shuts the removed person out of the group', async () => {
    const g = await seedGroup(client, { memberCount: 2 });
    const removedProfile = g.profileIds[1] as string;

    const visible = (): Promise<number> =>
      as(removedProfile, async () => {
        const { rows } = await client.query(`SELECT 1 FROM groups WHERE id = $1`, [g.groupId]);
        return rows.length;
      });
    expect(await visible()).toBe(1);

    await as(g.profileIds[0] as string, async () => {
      await client.query(`SELECT waves_remove_member($1)`, [g.memberIds[1]]);
    });

    expect(await visible()).toBe(0);
    await as(removedProfile, async () => {
      const { rows } = await client.query(`SELECT is_group_member($1) AS m`, [g.groupId]);
      expect(rows[0].m).toBe(false);
    });
  });

  it('removes a placeholder too, with nobody to notify', async () => {
    const g = await seedGroup(client, { memberCount: 1, ghostCount: 1 });
    const ghost = g.memberIds[1] as string;
    await as(g.profileIds[0] as string, async () => {
      await client.query(`SELECT waves_remove_member($1)`, [ghost]);
    });
    expect(await leftAt(ghost)).not.toBeNull();
    const { rows } = await client.query(`SELECT 1 FROM notifications WHERE group_id = $1`, [
      g.groupId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('tells the removed person, and nobody else', async () => {
    const g = await seedGroup(client, { memberCount: 3 });
    await as(g.profileIds[0] as string, async () => {
      await client.query(`SELECT waves_remove_member($1)`, [g.memberIds[1]]);
    });
    const { rows } = await client.query(
      `SELECT profile_id, kind FROM notifications WHERE group_id = $1`,
      [g.groupId],
    );
    expect(rows).toEqual([{ profile_id: g.profileIds[1], kind: 'member_removed' }]);
  });

  it('is not callable without signing in', async () => {
    const g = await seedGroup(client, { memberCount: 2 });
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ role: 'anon' }),
    ]);
    await client.query('SET ROLE anon');
    try {
      await expectDenied(client.query(`SELECT waves_remove_member($1)`, [g.memberIds[1]]));
    } finally {
      await client.query('RESET ROLE');
      await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
    }
  });
});
