/**
 * "This is me": a member already in a group takes the placeholder that was
 * added for them (20260925120000_this_is_me_claim).
 *
 * The case it exists for: somebody adds "Gemahl" by name and files the rent
 * against it, then Gemahl joins and arrives as a second, empty member. The
 * group shows the same person twice and the money sits on the placeholder.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, seedGroup } from './helpers';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client.end();
});

/** Session-scoped claims: the writes have to survive the call to be asserted on. */
async function asProfile<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  try {
    return await run();
  } finally {
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

function id(value: string | undefined, what: string): string {
  if (!value) throw new Error(`the seed produced no ${what}`);
  return value;
}

type Verdict = { ok: boolean; reason?: string; status?: string; claim_id?: string };

async function claimAsMe(profileId: string | undefined, memberId: string | undefined) {
  return asProfile(id(profileId, 'profile'), async () => {
    const { rows } = await client.query('SELECT public.waves_claim_member_as_me($1) AS v', [
      id(memberId, 'member'),
    ]);
    return rows[0].v as Verdict;
  });
}

async function decide(claimId: string, approve: boolean, as: string | undefined) {
  return asProfile(id(as, 'admin profile'), async () => {
    const { rows } = await client.query('SELECT public.waves_decide_member_claim($1, $2) AS v', [
      claimId,
      approve,
    ]);
    return rows[0].v as Verdict;
  });
}

async function row(memberId: string | undefined) {
  const { rows } = await client.query(
    `SELECT profile_id, ghost_name, role, joined_via, left_at
       FROM public.group_members WHERE id = $1`,
    [id(memberId, 'member')],
  );
  return rows[0] as {
    profile_id: string | null;
    ghost_name: string | null;
    role: string;
    joined_via: string | null;
    left_at: Date | null;
  };
}

async function liveRowsOf(groupId: string, profileId: string | undefined): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT id FROM public.group_members
      WHERE group_id = $1 AND profile_id = $2 AND left_at IS NULL`,
    [groupId, id(profileId, 'profile')],
  );
  return rows.map((r) => r.id as string);
}

describe('a member asks, an admin confirms', () => {
  it('changes nothing until an admin says yes, and asks every admin', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });

    const verdict = await claimAsMe(profileIds[1], memberIds[2]);
    expect(verdict).toMatchObject({ ok: true, status: 'pending' });

    expect((await row(memberIds[2])).profile_id).toBeNull();
    expect(await liveRowsOf(groupId, profileIds[1])).toEqual([memberIds[1]]);

    const { rows } = await client.query(
      `SELECT profile_id FROM public.notifications
        WHERE group_id = $1 AND kind = 'ghost_claim_requested'`,
      [groupId],
    );
    expect(rows.map((r) => r.profile_id)).toEqual([profileIds[0]]);
  });

  it('asking twice is the same request', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const first = await claimAsMe(profileIds[1], memberIds[2]);
    const second = await claimAsMe(profileIds[1], memberIds[2]);
    expect(second.claim_id).toBe(first.claim_id);
  });

  it('on approval the placeholder becomes theirs and their empty row retires', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const ghost = id(memberIds[2], 'ghost');
    // The history is on the placeholder: the admin paid, the placeholder owes.
    await addEqualSplitExpense(client, {
      groupId,
      payers: { [id(memberIds[0], 'admin')]: 1000n },
      participants: [id(memberIds[0], 'admin'), ghost],
      amount: 1000n,
    });

    const { claim_id } = await claimAsMe(profileIds[1], ghost);
    const verdict = await decide(id(claim_id, 'claim'), true, profileIds[0]);
    expect(verdict).toMatchObject({ ok: true, status: 'approved' });

    const taken = await row(ghost);
    expect(taken.profile_id).toBe(profileIds[1]);
    expect(taken.ghost_name).toBeNull();
    expect(taken.joined_via).toBe('self_claim');

    const retired = await row(memberIds[1]);
    expect(retired.profile_id).toBeNull();
    expect(retired.ghost_name).toBe('Member 2');
    expect(retired.left_at).not.toBeNull();

    // One person, one live row, and it is the one the money is on.
    expect(await liveRowsOf(groupId, profileIds[1])).toEqual([ghost]);
    const { rows } = await client.query(
      `SELECT balance FROM public.group_balances WHERE member_id = $1`,
      [ghost],
    );
    expect(BigInt(rows[0].balance)).toBe(-500n);
  });

  it('a decline leaves both rows as they were', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const { claim_id } = await claimAsMe(profileIds[1], memberIds[2]);
    await decide(id(claim_id, 'claim'), false, profileIds[0]);

    expect((await row(memberIds[2])).profile_id).toBeNull();
    expect(await liveRowsOf(groupId, profileIds[1])).toEqual([memberIds[1]]);
  });
});

describe('an admin saying it about themselves', () => {
  it('is confirmed at once, keeps them admin, and sends them nothing', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });

    const verdict = await claimAsMe(profileIds[0], memberIds[2]);
    expect(verdict).toMatchObject({ ok: true, status: 'approved' });

    const taken = await row(memberIds[2]);
    expect(taken.profile_id).toBe(profileIds[0]);
    expect(taken.role).toBe('admin');
    const retired = await row(memberIds[0]);
    expect(retired.role).toBe('member');
    expect(retired.left_at).not.toBeNull();

    const { rows } = await client.query(
      `SELECT 1 FROM public.notifications
        WHERE group_id = $1 AND kind = 'ghost_claim_approved'`,
      [groupId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('the ways it is refused', () => {
  it('refuses somebody whose own row already has money on it', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    await addEqualSplitExpense(client, {
      groupId,
      payers: { [id(memberIds[0], 'admin')]: 600n },
      participants: [id(memberIds[0], 'admin'), id(memberIds[1], 'member')],
      amount: 600n,
    });

    const verdict = await claimAsMe(profileIds[1], memberIds[2]);
    expect(verdict).toMatchObject({ ok: false, reason: 'HAS_HISTORY' });
    expect((await row(memberIds[2])).profile_id).toBeNull();
  });

  it('refuses at decision time too, if money landed on their row while waiting', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const { claim_id } = await claimAsMe(profileIds[1], memberIds[2]);
    await addEqualSplitExpense(client, {
      groupId,
      payers: { [id(memberIds[1], 'member')]: 400n },
      participants: [id(memberIds[0], 'admin'), id(memberIds[1], 'member')],
      amount: 400n,
    });

    const verdict = await decide(id(claim_id, 'claim'), true, profileIds[0]);
    expect(verdict).toMatchObject({ ok: false, reason: 'HAS_HISTORY' });
    expect(await liveRowsOf(groupId, profileIds[1])).toEqual([memberIds[1]]);
    expect((await row(memberIds[2])).profile_id).toBeNull();
  });

  it('will not take a place that belongs to somebody', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 3 });
    const verdict = await claimAsMe(profileIds[1], memberIds[2]);
    expect(verdict).toMatchObject({ ok: false, reason: 'ALREADY_CLAIMED' });
  });

  it('answers an outsider as if the place did not exist', async () => {
    const { memberIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const other = await seedGroup(client, { memberCount: 1 });

    const verdict = await claimAsMe(other.profileIds[0], memberIds[2]);
    expect(verdict).toMatchObject({ ok: false, reason: 'NOT_CLAIMABLE' });
    const missing = await claimAsMe(other.profileIds[0], randomUUID());
    expect(missing).toMatchObject({ ok: false, reason: 'NOT_CLAIMABLE' });
  });

  it('is not callable signed out', async () => {
    const { memberIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: 'anon' }),
      ]);
      await client.query('SET LOCAL ROLE anon');
      await expect(
        client.query('SELECT public.waves_claim_member_as_me($1)', [memberIds[2]]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
