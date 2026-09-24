/**
 * Muting one group.
 *
 * A live `group_mutes` row for (person, group) makes the push claim suppress
 * that person's pushes about that group — and nothing else. Pinned here:
 *
 *   - a muted group's push is suppressed, and its inbox row is kept;
 *   - another group of theirs still pushes;
 *   - an unmute (a tombstoned row) pushes again;
 *   - a notification with no group is never touched by a mute;
 *   - somebody else muting the group does not silence you;
 *   - a mute is private: another member cannot read it.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { asRole, connect, seedGroup } from './helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.end();
});

async function withPhone(profileId: string): Promise<void> {
  await client.query(
    `INSERT INTO push_tokens (profile_id, expo_push_token, platform) VALUES ($1, $2, 'android')`,
    [profileId, `ExponentPushToken[${randomUUID()}]`],
  );
}

async function mute(profileId: string, groupId: string, deleted = false): Promise<void> {
  await client.query(
    `INSERT INTO group_mutes (id, owner_user_id, group_id, deleted_at)
     VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)`,
    [randomUUID(), profileId, groupId, deleted],
  );
}

async function enqueue(profileId: string, groupId: string | null): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO notifications (profile_id, group_id, kind, title, body, dedupe_key)
     VALUES ($1, $2, 'expense_added', 'title', 'body', $3) RETURNING id`,
    [profileId, groupId, `mute-test:${randomUUID()}`],
  );
  return String(rows[0].id);
}

async function claim(id: string): Promise<{ claimed: boolean; status: string | null }> {
  const { rows: claimed } = await client.query(
    `SELECT id FROM waves_claim_push_notifications(500) WHERE id = $1`,
    [id],
  );
  const { rows } = await client.query(
    `SELECT push_status::text AS status FROM notifications WHERE id = $1`,
    [id],
  );
  return { claimed: claimed.length === 1, status: rows[0]?.status ?? null };
}

describe('a muted group', () => {
  it('suppresses the push and keeps the inbox row', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const me = profileIds[0]!;
    await withPhone(me);
    await mute(me, groupId);

    const id = await enqueue(me, groupId);
    expect(await claim(id)).toEqual({ claimed: false, status: 'suppressed' });
  });

  it('leaves the person’s other groups pushing', async () => {
    const muted = await seedGroup(client, { memberCount: 1 });
    const me = muted.profileIds[0]!;
    await withPhone(me);
    await mute(me, muted.groupId);

    const other = await seedGroup(client, { memberCount: 1 });
    const id = await enqueue(me, other.groupId);
    expect(await claim(id)).toEqual({ claimed: true, status: 'queued' });
  });

  it('pushes again once unmuted', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const me = profileIds[0]!;
    await withPhone(me);
    await mute(me, groupId, true);

    const id = await enqueue(me, groupId);
    expect(await claim(id)).toEqual({ claimed: true, status: 'queued' });
  });

  it('never touches a notification that is not about a group', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 1 });
    const me = profileIds[0]!;
    await withPhone(me);
    await mute(me, groupId);

    const id = await enqueue(me, null);
    expect(await claim(id)).toEqual({ claimed: true, status: 'queued' });
  });

  it('is one person’s: somebody else muting it does not silence you', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const [them, me] = profileIds as [string, string];
    await withPhone(me);
    await mute(them, groupId);

    const id = await enqueue(me, groupId);
    expect(await claim(id)).toEqual({ claimed: true, status: 'queued' });
  });

  it('is private: another member cannot read it, its owner can', async () => {
    const { groupId, profileIds } = await seedGroup(client, { memberCount: 2 });
    const [owner, other] = profileIds as [string, string];
    await mute(owner, groupId);

    const read = (profileId: string) =>
      asRole(client, 'authenticated', { sub: profileId, role: 'authenticated' }, async () => {
        const { rows } = await client.query(`SELECT id FROM group_mutes WHERE group_id = $1`, [
          groupId,
        ]);
        return rows.length;
      });

    expect(await read(other)).toBe(0);
    expect(await read(owner)).toBe(1);
  });
});
