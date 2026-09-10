/**
 * Deleting a group, Splitwise-style (A49).
 *
 * An admin can drop a group for everyone, settled or not (A64 — the old
 * settled-only refusal made a group nobody would ever square up undeletable by
 * anybody, forever). ADR-004 keeps the ledger append-only, so a delete is a
 * group-wide tombstone (`groups.deleted_at`), never a row delete. These pin the
 * boundary `waves_delete_group` enforces, which the client button only fronts:
 * an admin deletes whether or not the group is square; a non-admin is refused
 * (NOT_ADMIN); a second delete is a clean no-op.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;

async function asUser<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query(`SET ROLE authenticated`);
  try {
    return await run();
  } finally {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

async function deletedAt(groupId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT deleted_at FROM groups WHERE id = $1`, [groupId]);
  // pg hands back a Date for timestamptz; normalise to an ISO string so two
  // reads of the same instant compare equal (not two distinct Date objects).
  const value = (rows[0]?.deleted_at as Date | string | null) ?? null;
  return value === null ? null : new Date(value).toISOString();
}

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

describe('deleting a group', () => {
  it('lets an admin delete a fully-settled group, as a tombstone', async () => {
    // Two members with an expense that nets to zero — each pays exactly their own
    // share — so the group is square. Deleting it stamps `deleted_at` and leaves
    // every row in place (ADR-004).
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    await addEqualSplitExpense(client, {
      groupId,
      amount: 1000n,
      participants: [memberIds[0]!, memberIds[1]!],
      payers: { [memberIds[0]!]: 500n, [memberIds[1]!]: 500n },
    });

    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));

    expect(await deletedAt(groupId)).not.toBeNull();
    // The group row (and its expense) are still there — a tombstone hides it, it
    // is not erased.
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM expenses WHERE group_id = $1`,
      [groupId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses a non-admin member (NOT_ADMIN)', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });

    // profileIds[1] is an ordinary member, not an admin.
    const message = await asUser(profileIds[1]!, () =>
      expectDenied(client.query(`SELECT waves_delete_group($1)`, [groupId])),
    );
    expect(message).toMatch(/NOT_ADMIN/);
    expect(await deletedAt(groupId)).toBeNull();
  });

  it('lets an admin delete a group that still has an outstanding balance (A64)', async () => {
    // One member paid the whole bill; the other owes their share — the group is
    // not square. This used to be refused with NOT_SETTLED, which left a group
    // nobody intends to settle undeletable by anybody. The admin may now delete
    // it; the client is what warns that the record of this debt goes with it.
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    await addEqualSplitExpense(client, {
      groupId,
      amount: 1000n,
      participants: [memberIds[0]!, memberIds[1]!],
      payers: { [memberIds[0]!]: 1000n },
    });

    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));

    expect(await deletedAt(groupId)).not.toBeNull();
  });

  it('still refuses a non-admin when the group is unsettled (NOT_ADMIN)', async () => {
    // The one guard that did not go. Dropping the settled check must not have
    // widened the door for an ordinary member: an open balance is no more a
    // licence to delete for everyone than a squared-up one is.
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    await addEqualSplitExpense(client, {
      groupId,
      amount: 1000n,
      participants: [memberIds[0]!, memberIds[1]!],
      payers: { [memberIds[0]!]: 1000n },
    });

    const message = await asUser(profileIds[1]!, () =>
      expectDenied(client.query(`SELECT waves_delete_group($1)`, [groupId])),
    );
    expect(message).toMatch(/NOT_ADMIN/);
    expect(await deletedAt(groupId)).toBeNull();
  });

  it('writes down who did it', async () => {
    // The tombstone says a group was deleted and when; on its own it does not
    // say by whom, so a legitimate delete and a forged one were the same event
    // in the data that survives. Deleting a group destroys the record of who
    // owed whom for every member — the one action of that weight that left no
    // line in the feed.
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });

    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));

    const { rows } = await client.query(
      `SELECT actor_member_id, object_type, payload FROM activity_log
        WHERE group_id = $1 AND verb = 'group_deleted'`,
      [groupId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_member_id).toBe(memberIds[0]);
    expect(rows[0]?.object_type).toBe('group');
    // The name is captured before the row goes, because afterwards nothing in
    // the app will ever show that group again to read it off.
    expect(rows[0]?.payload?.name).toBe('Goa trip');
  });

  it('does not write a second audit row for a repeated delete', async () => {
    // The row goes after the idempotency check, so a retried offline queue flush
    // records the delete once rather than once per attempt.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });

    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));
    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM activity_log WHERE group_id = $1 AND verb = 'group_deleted'`,
      [groupId],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('is idempotent — a second delete is a clean no-op', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });

    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));
    const first = await deletedAt(groupId);
    expect(first).not.toBeNull();

    // A retried queue flush or a second tap must land cleanly, not raise, and not
    // move the tombstone's timestamp.
    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));
    expect(await deletedAt(groupId)).toBe(first);
  });

  it('holds the group row lock while deleting, serializing a concurrent writer', async () => {
    // The delete takes `FOR UPDATE` on the group row before it validates the
    // balances, so a balance-mutating writer that shares that lock cannot slip a
    // change in between the settled check and the tombstone. Prove it with a
    // second connection: while the delete's transaction is open, a `FOR UPDATE
    // NOWAIT` on the same row is refused (55P03) rather than interleaving.
    const { groupId, profileIds, memberIds } = await seedGroup(client, { memberCount: 2 });
    await addEqualSplitExpense(client, {
      groupId,
      amount: 1000n,
      participants: [memberIds[0]!, memberIds[1]!],
      payers: { [memberIds[0]!]: 500n, [memberIds[1]!]: 500n },
    });

    const other = await connect();
    try {
      // Connection A: run the delete inside an open transaction — it locks the
      // group row and does not commit yet.
      await client.query('BEGIN');
      await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));

      // Connection B: the same row lock is unavailable while A holds it.
      let refused = false;
      try {
        await other.query(`SELECT 1 FROM groups WHERE id = $1 FOR UPDATE NOWAIT`, [groupId]);
      } catch (caught) {
        const err = caught as { code?: string; message?: string };
        refused = err.code === '55P03' || /could not obtain lock|lock/i.test(err.message ?? '');
      }
      expect(refused).toBe(true);
    } finally {
      // Undo the uncommitted delete; the group is left as it was.
      await client.query('ROLLBACK');
      await other.end();
    }
  });
});
