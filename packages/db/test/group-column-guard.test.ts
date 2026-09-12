/**
 * Which columns of a group an ordinary member may write, and which they may not.
 *
 * `authenticated` holds a table-wide UPDATE on `public.groups` and the
 * `groups_update` policy scopes it to members of the row. There are no
 * column-level ACLs anywhere in this schema, so `waves_guard_group_columns` is
 * the only thing between "a member may edit this group" and "a member may edit
 * *this column*" — and it is reached by a plain PostgREST PATCH, with no RPC and
 * no `/sync` in the way.
 *
 * These tests go through the same door: `SET ROLE authenticated` and a bare
 * UPDATE. That is the shape of the exploit — a member deleting a group for
 * everybody by writing `deleted_at` themselves, or resurrecting one by clearing
 * it — so it is the shape the test has to take. Anything routed through an RPC
 * would prove nothing, because the RPCs are exactly what the exploit skips.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

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

/** One `UPDATE groups SET <column> = <value>` run as an ordinary member. */
function patch(profileId: string, groupId: string, column: string, value: unknown) {
  return asUser(profileId, () =>
    client.query(`UPDATE groups SET ${column} = $1 WHERE id = $2`, [value, groupId]),
  );
}

async function deletedAt(groupId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT deleted_at FROM groups WHERE id = $1`, [groupId]);
  const value = (rows[0]?.deleted_at as Date | string | null) ?? null;
  return value === null ? null : new Date(value).toISOString();
}

describe('a member cannot delete a group by hand', () => {
  it('refuses a direct write to deleted_at', async () => {
    // profileIds[1] is an ordinary member. `waves_delete_group` would answer
    // NOT_ADMIN; before the guard learned this column, the same person could
    // simply write it and skip the question.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });

    const message = await expectDenied(
      patch(profileIds[1]!, groupId, 'deleted_at', new Date().toISOString()),
    );

    expect(message).toMatch(/FORBIDDEN_COLUMN/);
    expect(message).toMatch(/deleted_at/);
    expect(await deletedAt(groupId)).toBeNull();
  });

  it('refuses it to an admin too, because the RPC is the only door', async () => {
    // Not because an admin may not delete — they may — but because the delete
    // has to go through the function that takes the row lock and writes the
    // audit row. A guard that made an exception for admins would be a guard
    // that has to work out who is an admin, which is the RPC's job.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });

    const message = await expectDenied(
      patch(profileIds[0]!, groupId, 'deleted_at', new Date().toISOString()),
    );

    expect(message).toMatch(/FORBIDDEN_COLUMN/);
    expect(await deletedAt(groupId)).toBeNull();
  });

  it('refuses clearing deleted_at, which is the same authority in reverse', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));
    const stamped = await deletedAt(groupId);
    expect(stamped).not.toBeNull();

    const message = await expectDenied(patch(profileIds[1]!, groupId, 'deleted_at', null));

    expect(message).toMatch(/FORBIDDEN_COLUMN/);
    expect(await deletedAt(groupId)).toBe(stamped);
  });
});

describe('the guard is an allowlist, not a list of known villains', () => {
  it('refuses the overall trip budget, which is admin-only in its RPC', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });

    const message = await expectDenied(patch(profileIds[1]!, groupId, 'budget_minor', '500000'));
    expect(message).toMatch(/FORBIDDEN_COLUMN/);

    const currency = await expectDenied(patch(profileIds[1]!, groupId, 'budget_currency', 'EUR'));
    expect(currency).toMatch(/FORBIDDEN_COLUMN/);

    const { rows } = await client.query(
      `SELECT budget_minor, budget_currency FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(rows[0]?.budget_minor).toBeNull();
    expect(rows[0]?.budget_currency).toBeNull();
  });

  it('still refuses the four columns the old enumerated guard named', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const member = profileIds[1]!;

    for (const [column, value] of [
      ['updated_seq', '9999'],
      ['created_by', randomUUID()],
      ['created_at', new Date(0).toISOString()],
      ['category_budgets', '{"food":{"amountMinor":"100","currency":"INR"}}'],
      ['fx_rates', '{"EUR":{"num":"90","den":"1"}}'],
      ['join_token', 'forged-token'],
    ] as const) {
      const message = await expectDenied(patch(member, groupId, column, value));
      expect(message, column).toMatch(/FORBIDDEN_COLUMN/);
    }
  });

  it('names the column it refused, so a bug report says which one', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const message = await expectDenied(patch(profileIds[1]!, groupId, 'updated_seq', '4'));
    expect(message).toMatch(/updated_seq/);
  });
});

describe('the columns the app actually writes still go through', () => {
  it('lets a member rename, re-emoji and re-date the group', async () => {
    // Exactly the fields `/sync`'s GROUP_UPDATABLE_FIELDS allows. If this test
    // fails, the allowlist and the edge function have drifted apart.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const member = profileIds[1]!;

    await patch(member, groupId, 'name', 'Goa 2026');
    await patch(member, groupId, 'description', 'January, the four of us');
    await patch(member, groupId, 'cover_emoji', '🏖️');
    await patch(member, groupId, 'start_date', '2026-01-01');
    await patch(member, groupId, 'end_date', '2026-01-08');
    await patch(member, groupId, 'time_zone', 'Asia/Kolkata');
    await patch(member, groupId, 'remind_daily', false);
    await patch(member, groupId, 'simplify_debts', false);
    await patch(member, groupId, 'default_currency', 'EUR');
    await patch(member, groupId, 'country_code', 'IN');

    const { rows } = await client.query(
      `SELECT name, description, cover_emoji, remind_daily FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(rows[0]?.name).toBe('Goa 2026');
    expect(rows[0]?.description).toBe('January, the four of us');
    expect(rows[0]?.remind_daily).toBe(false);
  });

  it('caps a description at 280 characters, and lets exactly 280 through', async () => {
    // The cap is the column's, not the input's. The client's `maxLength` stops
    // a paragraph being typed, but the client is not the only writer — a
    // PostgREST PATCH is the same door the tests above use, and a description
    // longer than the column allows has to be refused there rather than stored.
    //
    // `char_length`, so the cap means the same number of characters in every
    // script the app speaks. A Tamil description of 280 characters is 280, not
    // the 93 an octet cap would have allowed.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const member = profileIds[1]!;

    await patch(member, groupId, 'description', 'a'.repeat(280));
    await patch(member, groupId, 'description', 'கோ'.repeat(140));

    const message = await expectDenied(patch(member, groupId, 'description', 'a'.repeat(281)));
    expect(message).toMatch(/groups_description_length/);

    // Refused, so the last accepted write is what the column still holds.
    const { rows } = await client.query(`SELECT description FROM groups WHERE id = $1`, [groupId]);
    expect(rows[0]?.description).toBe('கோ'.repeat(140));
  });

  it('lets a member clear a description back to NULL', async () => {
    // Clearing is an ordinary edit, not a special case — the group goes back to
    // saying nothing about itself. It has to reach the column as NULL rather
    // than '', which is what the `/sync` boundary normalises, but the guard
    // must not stand in the way of either.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const member = profileIds[1]!;

    await patch(member, groupId, 'description', 'January, the four of us');
    await patch(member, groupId, 'description', null);

    const { rows } = await client.query(`SELECT description FROM groups WHERE id = $1`, [groupId]);
    expect(rows[0]?.description).toBeNull();
  });

  it('lets a member archive and unarchive, which is deliberate', async () => {
    // Archiving is in the `/sync` whitelist: any member putting a finished trip
    // away is the shipped capability, not an escalation. It is the one column on
    // this list that looks like `deleted_at` and is not.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const member = profileIds[1]!;

    await patch(member, groupId, 'archived_at', new Date().toISOString());
    await patch(member, groupId, 'archived_at', null);

    const { rows } = await client.query(`SELECT archived_at FROM groups WHERE id = $1`, [groupId]);
    expect(rows[0]?.archived_at).toBeNull();
  });

  it('leaves the stamp trigger free to bump updated_seq behind the guard', async () => {
    // The guard sorts before the stamp, so an ordinary write arrives with
    // NEW.updated_seq still equal to OLD's and is stamped afterwards. Refusing
    // the column outright would be useless if that order were the other way.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const before = await client.query(`SELECT updated_seq FROM groups WHERE id = $1`, [groupId]);

    await patch(profileIds[1]!, groupId, 'name', 'Bumped');

    const after = await client.query(`SELECT updated_seq FROM groups WHERE id = $1`, [groupId]);
    expect(BigInt(String(after.rows[0]?.updated_seq))).toBeGreaterThan(
      BigInt(String(before.rows[0]?.updated_seq)),
    );
  });

  it('leaves the definer RPCs alone', async () => {
    // The guard only fires for anon/authenticated, so a SECURITY DEFINER
    // function writing a guarded column runs as its owner and passes through.
    // Proving it on the one that matters most: the delete still works.
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    await asUser(profileIds[0]!, () => client.query(`SELECT waves_delete_group($1)`, [groupId]));
    expect(await deletedAt(groupId)).not.toBeNull();
  });
});
