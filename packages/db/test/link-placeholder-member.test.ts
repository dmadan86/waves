/**
 * "Link to a Waves user": an admin says which real person a placeholder is
 * (20261022120000_link_placeholder_member).
 *
 * Two shapes. The person is already in the group as themselves — the same
 * human listed twice — and the admin merges the placeholder into them on the
 * spot. Or the person is not in the group, and the admin asks them: only they
 * can accept, because attaching an account to a history is theirs to agree to.
 *
 * The invariants pinned here are the ones the ledger cannot afford to lose:
 * every balance in the group sums to zero before and after, the projection
 * matches the truth query, no ledger row is updated in place (a merge is one
 * new version per bill), and the authorisation lines — who may merge, who may
 * ask, who may answer — hold at the database.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import {
  addEqualSplitExpense,
  asRole,
  connect,
  expectDenied,
  readBalances,
  readTruth,
  seedGroup,
} from './helpers';

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

type Verdict = {
  ok: boolean;
  reason?: string;
  status?: string;
  request_id?: string;
  member_id?: string;
  bills?: number;
  settlements?: number;
  settlements_cancelled?: number;
  already_pending?: boolean;
};

async function rpc(as: string | undefined, sql: string, params: unknown[]): Promise<Verdict> {
  return asProfile(id(as, 'profile'), async () => {
    const { rows } = await client.query(sql, params);
    return rows[0].v as Verdict;
  });
}

const merge = (as: string | undefined, ghost: string, into: string) =>
  rpc(as, 'SELECT public.waves_merge_member_into($1, $2) AS v', [ghost, into]);
const request = (as: string | undefined, ghost: string, target: string) =>
  rpc(as, 'SELECT public.waves_request_member_link($1, $2) AS v', [ghost, target]);
const decide = (as: string | undefined, requestId: string, accept: boolean) =>
  rpc(as, 'SELECT public.waves_decide_member_link($1, $2) AS v', [requestId, accept]);
const cancel = (as: string | undefined, requestId: string) =>
  rpc(as, 'SELECT public.waves_cancel_member_link($1) AS v', [requestId]);

async function row(memberId: string) {
  const { rows } = await client.query(
    `SELECT profile_id, ghost_name, role, joined_via, left_at, merged_into_member_id
       FROM public.group_members WHERE id = $1`,
    [memberId],
  );
  return rows[0] as {
    profile_id: string | null;
    ghost_name: string | null;
    role: string;
    joined_via: string | null;
    left_at: Date | null;
    merged_into_member_id: string | null;
  };
}

async function notified(groupId: string, kind: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT profile_id FROM public.notifications WHERE group_id = $1 AND kind = $2`,
    [groupId, kind],
  );
  return rows.map((r) => r.profile_id as string);
}

async function settle(
  groupId: string,
  from: string,
  to: string,
  amount: bigint,
  status = 'confirmed',
): Promise<string> {
  const settlementId = randomUUID();
  await client.query(
    `INSERT INTO settlements (id, group_id, from_member_id, to_member_id, currency, amount, method, status)
     VALUES ($1, $2, $3, $4, 'INR', $5, 'cash', $6)`,
    [settlementId, groupId, from, to, amount, status],
  );
  return settlementId;
}

function sum(balances: Map<string, bigint>): bigint {
  let total = 0n;
  for (const value of balances.values()) total += value;
  return total;
}

/** A second profile that shares a group with `profileId`, in a group of its own. */
async function friendOf(profileId: string): Promise<{ profileId: string; groupId: string }> {
  const other = await seedGroup(client, { memberCount: 1, name: 'Elsewhere' });
  await client.query(
    `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
     VALUES ($1, $2, $3, 'member', 'invite_link')`,
    [randomUUID(), other.groupId, profileId],
  );
  return { profileId: id(other.profileIds[0], 'friend'), groupId: other.groupId };
}

describe('A. merging a placeholder into a member already in the group', () => {
  it('moves every bill, keeps the group summing to zero, and retires the placeholder', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 3,
      ghostCount: 1,
    });
    const admin = id(memberIds[0], 'admin');
    const arun = id(memberIds[1], 'arun');
    const third = id(memberIds[2], 'third');
    const renny = id(memberIds[3], 'ghost');

    // Renny owes the admin for dinner; Renny paid for the taxi everyone took;
    // Renny and Arun were both on the same bill, so their lines must fold.
    await addEqualSplitExpense(client, {
      groupId,
      payers: { [admin]: 1200n },
      participants: [admin, renny, third],
      amount: 1200n,
      description: 'Dinner',
    });
    await addEqualSplitExpense(client, {
      groupId,
      payers: { [renny]: 900n },
      participants: [admin, renny, arun],
      amount: 900n,
      description: 'Taxi',
    });
    const both = await addEqualSplitExpense(client, {
      groupId,
      payers: { [arun]: 400n },
      participants: [renny, arun],
      amount: 400n,
      description: 'Coffee',
    });
    // Renny paid the third member back, and once paid Arun — a payment to
    // themselves once they are one person.
    await settle(groupId, renny, third, 100n);
    const selfPayment = await settle(groupId, renny, arun, 50n);
    await client.query(
      `INSERT INTO expense_comments (group_id, expense_id, author_member_id, body)
       VALUES ($1, $2, $3, 'was this split right?')`,
      [groupId, both.expenseId, renny],
    );

    const before = await readBalances(client, groupId);
    const rennyBefore = before.get(renny) ?? 0n;
    const arunBefore = before.get(arun) ?? 0n;
    expect(sum(before)).toBe(0n);

    const verdict = await merge(profileIds[0], renny, arun);
    expect(verdict).toMatchObject({ ok: true, bills: 3, settlements: 1, settlements_cancelled: 1 });

    const after = await readBalances(client, groupId);
    expect(sum(after)).toBe(0n);
    expect(after.get(renny) ?? 0n).toBe(0n);
    // The self-payment counted +50 for Renny and -50 for Arun before; cancelled,
    // the pair nets to exactly what the two of them held between them.
    // (The projection keeps no row for a zero balance, hence the fallbacks.)
    expect(after.get(arun) ?? 0n).toBe(rennyBefore + arunBefore);
    expect(after.get(admin) ?? 0n).toBe(before.get(admin) ?? 0n);
    expect(after.get(third) ?? 0n).toBe(before.get(third) ?? 0n);
    expect(await readTruth(client, groupId)).toEqual(after);

    // One new version per bill, the old one still there (ADR-004), and the
    // shared bill has one line for Arun worth both their shares.
    const { rows: versions } = await client.query(
      `SELECT e.id, count(v.id)::int AS versions
         FROM expenses e JOIN expense_versions v ON v.expense_id = e.id
        WHERE e.group_id = $1 GROUP BY e.id`,
      [groupId],
    );
    expect(versions.map((r) => r.versions)).toEqual([2, 2, 2]);
    const { rows: coffee } = await client.query(
      `SELECT s.member_id, s.amount::text
         FROM expenses e JOIN expense_shares s ON s.expense_version_id = e.current_version_id
        WHERE e.id = $1`,
      [both.expenseId],
    );
    expect(coffee).toEqual([{ member_id: arun, amount: '400' }]);

    const { rows: cancelled } = await client.query(`SELECT status FROM settlements WHERE id = $1`, [
      selfPayment,
    ]);
    expect(cancelled[0].status).toBe('cancelled');
    // Nobody is told a payment to themselves was withdrawn.
    expect(await notified(groupId, 'settlement_cancelled')).toEqual([]);

    const { rows: comments } = await client.query(
      `SELECT author_member_id FROM expense_comments WHERE expense_id = $1`,
      [both.expenseId],
    );
    expect(comments[0].author_member_id).toBe(arun);

    const retired = await row(renny);
    expect(retired.left_at).not.toBeNull();
    expect(retired.merged_into_member_id).toBe(arun);
    expect(retired.ghost_name).toBe('Ghost 1');
    expect(retired.profile_id).toBeNull();

    const { rows: activity } = await client.query(
      `SELECT verb, object_id, payload FROM activity_log
        WHERE group_id = $1 AND verb = 'merged'`,
      [groupId],
    );
    expect(activity).toHaveLength(1);
    expect(activity[0].object_id).toBe(renny);
    expect(activity[0].payload).toMatchObject({ into_member_id: arun, bills: 3 });

    // Arun hears about it; the admin who did it does not need telling.
    expect(await notified(groupId, 'member_linked')).toEqual([profileIds[1]]);
  });

  it('is an admin power: a member, an outsider and anon are all refused', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const ghost = id(memberIds[2], 'ghost');
    const arun = id(memberIds[1], 'member');
    const stranger = await seedGroup(client, { memberCount: 1 });

    expect(await merge(profileIds[1], ghost, arun)).toMatchObject({
      ok: false,
      reason: 'NOT_ALLOWED',
    });
    expect(await merge(stranger.profileIds[0], ghost, arun)).toMatchObject({
      ok: false,
      reason: 'NOT_ALLOWED',
    });
    const denied = await expectDenied(
      asRole(client, 'anon', {}, () =>
        client.query('SELECT public.waves_merge_member_into($1, $2)', [ghost, arun]),
      ),
    );
    expect(denied).toMatch(/permission denied/);
    expect((await row(ghost)).left_at).toBeNull();
    expect(await readBalances(client, groupId)).toEqual(await readTruth(client, groupId));
  });

  it('only a placeholder can be merged, and only into a member of the same group', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 2 });
    const other = await seedGroup(client, { memberCount: 1 });
    const admin = id(memberIds[0], 'admin');
    const arun = id(memberIds[1], 'arun');
    const ghostA = id(memberIds[2], 'ghost');
    const ghostB = id(memberIds[3], 'ghost');

    // A real person is not a placeholder.
    expect(await merge(profileIds[0], arun, admin)).toMatchObject({ reason: 'NOT_A_PLACEHOLDER' });
    // Into another placeholder: that is the Friends-list fold, not this.
    expect(await merge(profileIds[0], ghostA, ghostB)).toMatchObject({ reason: 'NOT_IN_GROUP' });
    // Into a member of some other group.
    expect(await merge(profileIds[0], ghostA, id(other.memberIds[0], 'm'))).toMatchObject({
      reason: 'NOT_IN_GROUP',
    });
    // Into itself.
    expect(await merge(profileIds[0], ghostA, ghostA)).toMatchObject({ reason: 'NOT_IN_GROUP' });
    expect((await row(ghostA)).left_at).toBeNull();
  });

  it('the fold itself is not callable by an app user', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const denied = await expectDenied(
      asRole(client, 'authenticated', { sub: profileIds[0], role: 'authenticated' }, () =>
        client.query('SELECT public.waves_fold_member_into($1, $2, $3)', [
          memberIds[2],
          memberIds[1],
          memberIds[0],
        ]),
      ),
    );
    expect(denied).toMatch(/permission denied/);
  });

  it('a pending ask on the placeholder is cancelled by the merge', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const ghost = id(memberIds[2], 'ghost');
    const friend = await friendOf(id(profileIds[0], 'admin'));
    const asked = await request(profileIds[0], ghost, friend.profileId);
    expect(asked).toMatchObject({ ok: true, status: 'pending' });

    expect(await merge(profileIds[0], ghost, id(memberIds[1], 'arun'))).toMatchObject({ ok: true });

    const { rows } = await client.query(`SELECT status FROM member_link_requests WHERE id = $1`, [
      asked.request_id,
    ]);
    expect(rows[0].status).toBe('cancelled');
    expect(await decide(friend.profileId, id(asked.request_id, 'request'), true)).toMatchObject({
      reason: 'ALREADY_DECIDED',
    });
    expect(groupId).toBeTruthy();
  });
});

describe('B. asking somebody who is not in the group', () => {
  it('an admin asks a group-mate, who is told; nothing in the group changes', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const ghost = id(memberIds[2], 'ghost');
    const friend = await friendOf(id(profileIds[0], 'admin'));

    const verdict = await request(profileIds[0], ghost, friend.profileId);
    expect(verdict).toMatchObject({ ok: true, status: 'pending' });
    expect(verdict.request_id).toBeTruthy();

    expect(await notified(groupId, 'member_link_requested')).toEqual([friend.profileId]);
    expect((await row(ghost)).profile_id).toBeNull();

    // Asking again is the same ask.
    const again = await request(profileIds[0], ghost, friend.profileId);
    expect(again).toMatchObject({
      ok: true,
      request_id: verdict.request_id,
      already_pending: true,
    });

    // The admin sees it waiting; the person asked sees it addressed to them.
    const mine = await asProfile(id(profileIds[0], 'admin'), () =>
      client.query('SELECT * FROM public.waves_group_member_links($1)', [groupId]),
    );
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]).toMatchObject({ member_id: ghost, target_id: friend.profileId });
    const theirs = await asProfile(friend.profileId, () =>
      client.query('SELECT * FROM public.waves_my_member_links()'),
    );
    expect(theirs.rows).toHaveLength(1);
    expect(theirs.rows[0]).toMatchObject({
      id: verdict.request_id,
      group_id: groupId,
      ghost_name: 'Ghost 1',
      requester_name: 'Member 1',
    });
    // A plain member does not see the group's asks.
    const notMine = await asProfile(id(profileIds[1], 'member'), () =>
      client.query('SELECT * FROM public.waves_group_member_links($1)', [groupId]),
    );
    expect(notMine.rows).toHaveLength(0);
  });

  it('only an admin may ask, and only for a placeholder', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const friend = await friendOf(id(profileIds[1], 'member'));
    expect(await request(profileIds[1], id(memberIds[2], 'ghost'), friend.profileId)).toMatchObject(
      { ok: false, reason: 'NOT_ALLOWED' },
    );
    const adminsFriend = await friendOf(id(profileIds[0], 'admin'));
    expect(
      await request(profileIds[0], id(memberIds[1], 'member'), adminsFriend.profileId),
    ).toMatchObject({ ok: false, reason: 'NOT_A_PLACEHOLDER' });
  });

  it('cannot name an arbitrary id: a stranger, a guest, yourself, or nobody', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const ghost = id(memberIds[2], 'ghost');
    const stranger = await seedGroup(client, { memberCount: 1 });

    // Shares no group and has turned off being found: "nobody there".
    await client.query(
      `UPDATE profiles SET discoverable_by_phone = false, discoverable_by_email = false WHERE id = $1`,
      [stranger.profileIds[0]],
    );
    expect(await request(profileIds[0], ghost, id(stranger.profileIds[0], 's'))).toMatchObject({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(await request(profileIds[0], ghost, randomUUID())).toMatchObject({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(await request(profileIds[0], ghost, id(profileIds[0], 'me'))).toMatchObject({
      ok: false,
      reason: 'THAT_IS_YOU',
    });

    // The same stranger, once they have said people with their number may
    // find them, can be asked.
    await client.query(`UPDATE profiles SET discoverable_by_phone = true WHERE id = $1`, [
      stranger.profileIds[0],
    ]);
    expect(await request(profileIds[0], ghost, id(stranger.profileIds[0], 's'))).toMatchObject({
      ok: true,
      status: 'pending',
    });
  });

  it('somebody already in the group is a merge, not an ask', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    expect(
      await request(profileIds[0], id(memberIds[2], 'ghost'), id(profileIds[1], 'arun')),
    ).toMatchObject({ ok: false, reason: 'ALREADY_IN_GROUP', member_id: memberIds[1] });
  });

  it('is rate limited per asker per day', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const admin = id(profileIds[0], 'admin');
    const friend = await friendOf(admin);
    for (let index = 0; index < 20; index += 1) {
      await client.query(
        `INSERT INTO member_link_requests (group_id, member_id, target_profile_id, requested_by, status, decided_at)
         VALUES ($1, $2, $3, $4, 'declined', now())`,
        [groupId, memberIds[2], friend.profileId, admin],
      );
    }
    expect(await request(admin, id(memberIds[2], 'ghost'), friend.profileId)).toMatchObject({
      ok: false,
      reason: 'RATE_LIMITED',
    });
  });

  it('only the person asked can answer; accepting takes the place and its history', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const admin = id(memberIds[0], 'admin');
    const ghost = id(memberIds[2], 'ghost');
    const friend = await friendOf(id(profileIds[0], 'admin'));
    await addEqualSplitExpense(client, {
      groupId,
      payers: { [admin]: 1000n },
      participants: [admin, ghost],
      amount: 1000n,
    });
    const before = await readBalances(client, groupId);

    const asked = await request(profileIds[0], ghost, friend.profileId);
    const requestId = id(asked.request_id, 'request');

    // Not theirs to answer — the asker, a group member, a stranger.
    expect(await decide(profileIds[0], requestId, true)).toMatchObject({
      reason: 'NO_SUCH_REQUEST',
    });
    expect(await decide(profileIds[1], requestId, true)).toMatchObject({
      reason: 'NO_SUCH_REQUEST',
    });
    const stranger = await seedGroup(client, { memberCount: 1 });
    expect(await decide(stranger.profileIds[0], requestId, true)).toMatchObject({
      reason: 'NO_SUCH_REQUEST',
    });
    expect((await row(ghost)).profile_id).toBeNull();

    const verdict = await decide(friend.profileId, requestId, true);
    expect(verdict).toMatchObject({ ok: true, status: 'accepted', member_id: ghost });

    const taken = await row(ghost);
    expect(taken.profile_id).toBe(friend.profileId);
    expect(taken.ghost_name).toBeNull();
    expect(taken.joined_via).toBe('link_request');
    expect(taken.left_at).toBeNull();

    // The money did not move: it was on this row and still is.
    expect(await readBalances(client, groupId)).toEqual(before);
    expect(await readTruth(client, groupId)).toEqual(before);

    expect(await notified(groupId, 'member_link_accepted')).toEqual([profileIds[0]]);
    expect(await decide(friend.profileId, requestId, true)).toMatchObject({
      reason: 'ALREADY_DECIDED',
      status: 'accepted',
    });
    const { rows } = await client.query(
      `SELECT verb, payload FROM activity_log WHERE group_id = $1 AND verb = 'claimed'`,
      [groupId],
    );
    expect(rows[0].payload).toMatchObject({ via: 'link_request' });
  });

  it('"not me" tells the asker and leaves the placeholder alone', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const ghost = id(memberIds[2], 'ghost');
    const friend = await friendOf(id(profileIds[0], 'admin'));
    const asked = await request(profileIds[0], ghost, friend.profileId);

    expect(await decide(friend.profileId, id(asked.request_id, 'r'), false)).toMatchObject({
      ok: true,
      status: 'declined',
    });
    expect((await row(ghost)).profile_id).toBeNull();
    expect(await notified(groupId, 'member_link_declined')).toEqual([profileIds[0]]);

    // The place is free to be asked about again.
    const again = await request(profileIds[0], ghost, friend.profileId);
    expect(again).toMatchObject({ ok: true, status: 'pending' });
    expect(again.request_id).not.toBe(asked.request_id);
  });

  it('accepting after joining by another route: an empty own row retires, a used one takes the fold', async () => {
    // Empty own row: they take the placeholder, their own row retires.
    {
      const { groupId, memberIds, profileIds } = await seedGroup(client, {
        memberCount: 2,
        ghostCount: 1,
      });
      const ghost = id(memberIds[2], 'ghost');
      const friend = await friendOf(id(profileIds[0], 'admin'));
      const asked = await request(profileIds[0], ghost, friend.profileId);
      const ownRow = randomUUID();
      await client.query(
        `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
         VALUES ($1, $2, $3, 'member', 'invite_link')`,
        [ownRow, groupId, friend.profileId],
      );
      expect(await decide(friend.profileId, id(asked.request_id, 'r'), true)).toMatchObject({
        ok: true,
        member_id: ghost,
      });
      expect((await row(ghost)).profile_id).toBe(friend.profileId);
      const retired = await row(ownRow);
      expect(retired.profile_id).toBeNull();
      expect(retired.left_at).not.toBeNull();
    }
    // Own row with money on it: the placeholder folds into it instead.
    {
      const { groupId, memberIds, profileIds } = await seedGroup(client, {
        memberCount: 2,
        ghostCount: 1,
      });
      const admin = id(memberIds[0], 'admin');
      const ghost = id(memberIds[2], 'ghost');
      const friend = await friendOf(id(profileIds[0], 'admin'));
      const asked = await request(profileIds[0], ghost, friend.profileId);
      const ownRow = randomUUID();
      await client.query(
        `INSERT INTO group_members (id, group_id, profile_id, role, joined_via)
         VALUES ($1, $2, $3, 'member', 'invite_link')`,
        [ownRow, groupId, friend.profileId],
      );
      await addEqualSplitExpense(client, {
        groupId,
        payers: { [admin]: 600n },
        participants: [admin, ghost, ownRow],
        amount: 600n,
      });
      const before = await readBalances(client, groupId);
      expect(await decide(friend.profileId, id(asked.request_id, 'r'), true)).toMatchObject({
        ok: true,
        member_id: ownRow,
      });
      const after = await readBalances(client, groupId);
      expect(sum(after)).toBe(0n);
      expect(after.get(ownRow)).toBe((before.get(ownRow) ?? 0n) + (before.get(ghost) ?? 0n));
      expect(await readTruth(client, groupId)).toEqual(after);
      expect((await row(ghost)).merged_into_member_id).toBe(ownRow);
    }
  });

  it('the asker or an admin can take it back; nobody else can', async () => {
    const { memberIds, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const ghost = id(memberIds[2], 'ghost');
    const friend = await friendOf(id(profileIds[0], 'admin'));
    const asked = await request(profileIds[0], ghost, friend.profileId);
    const requestId = id(asked.request_id, 'r');

    expect(await cancel(profileIds[1], requestId)).toMatchObject({ reason: 'NO_SUCH_REQUEST' });
    expect(await cancel(friend.profileId, requestId)).toMatchObject({ reason: 'NO_SUCH_REQUEST' });
    expect(await cancel(profileIds[0], requestId)).toMatchObject({ ok: true, status: 'cancelled' });
    expect(await decide(friend.profileId, requestId, true)).toMatchObject({
      reason: 'ALREADY_DECIDED',
    });
  });

  it('candidates are the people you share a group with who are not already here', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2, ghostCount: 1 });
    const admin = id(profileIds[0], 'admin');
    const friend = await friendOf(admin);
    const unrelated = await seedGroup(client, { memberCount: 1 });

    const { rows } = await asProfile(admin, () =>
      client.query('SELECT profile_id FROM public.waves_member_link_candidates($1)', [groupId]),
    );
    const ids = rows.map((r) => r.profile_id as string);
    expect(ids).toContain(friend.profileId);
    expect(ids).not.toContain(admin);
    expect(ids).not.toContain(profileIds[1]);
    expect(ids).not.toContain(unrelated.profileIds[0]);

    // Not for somebody outside the group.
    const outside = await asProfile(id(unrelated.profileIds[0], 'u'), () =>
      client.query('SELECT profile_id FROM public.waves_member_link_candidates($1)', [groupId]),
    );
    expect(outside.rows).toHaveLength(0);
  });

  it('the table is read-only to the app and only visible to its parties', async () => {
    const { groupId, memberIds, profileIds } = await seedGroup(client, {
      memberCount: 2,
      ghostCount: 1,
    });
    const friend = await friendOf(id(profileIds[0], 'admin'));
    await request(profileIds[0], id(memberIds[2], 'ghost'), friend.profileId);

    const claims = (sub: string) => ({ sub, role: 'authenticated' });
    const seen = async (sub: string) =>
      asRole(client, 'authenticated', claims(sub), async () => {
        const { rows } = await client.query(
          `SELECT id FROM member_link_requests WHERE group_id = $1`,
          [groupId],
        );
        return rows.length;
      });
    expect(await seen(id(profileIds[0], 'admin'))).toBe(1);
    expect(await seen(friend.profileId)).toBe(1);
    expect(await seen(id(profileIds[1], 'member'))).toBe(0);

    const denied = await expectDenied(
      asRole(client, 'authenticated', claims(id(profileIds[0], 'admin')), () =>
        client.query(
          `INSERT INTO member_link_requests (group_id, member_id, target_profile_id, requested_by)
           VALUES ($1, $2, $3, $4)`,
          [groupId, memberIds[2], friend.profileId, profileIds[0]],
        ),
      ),
    );
    expect(denied).toMatch(/permission denied|row-level security/);

    // Nor can the app write the merge column by hand.
    const guarded = await expectDenied(
      asRole(client, 'authenticated', claims(id(profileIds[0], 'admin')), () =>
        client.query(`UPDATE group_members SET merged_into_member_id = $1 WHERE id = $2`, [
          memberIds[1],
          memberIds[2],
        ]),
      ),
    );
    expect(guarded).toMatch(/FORBIDDEN_COLUMN|permission denied/);
  });
});
