/**
 * E2EE mailbox: devices, send validation, per-recipient access, leave cleanup,
 * the content-free rent hint, and the retirement of group_records.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, expectDenied, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let couple: SeededGroup;
let trip: SeededGroup;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  couple = await seedGroup(client, { memberCount: 2, name: 'Us' });
  await client.query(`UPDATE groups SET type = 'couple' WHERE id = $1`, [couple.groupId]);
  trip = await seedGroup(client, { memberCount: 2, name: 'Trip' });
});

async function as<T>(profileId: string, run: () => Promise<T>, role = 'authenticated') {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role }),
  ]);
  await client.query(`SET ROLE ${role}`);
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

const [alice, bob] = [0, 1] as const;

async function register(profileId: string, key = randomBytes(32)): Promise<string> {
  const r = await as(profileId, () =>
    client.query(`SELECT waves_register_device($1::bytea) AS id`, [key]),
  );
  return r.rows[0].id;
}

const ct = (n = 16) => randomBytes(n).toString('base64');

async function send(
  profileId: string,
  groupId: string,
  sender: string,
  items: unknown[],
  hint: string | null = null,
  eventId: string | null = null,
) {
  return as(profileId, () =>
    client.query(`SELECT waves_mailbox_send($1, $2, $3::jsonb, $4, $5) AS n`, [
      groupId,
      sender,
      JSON.stringify(items),
      hint,
      eventId,
    ]),
  );
}

async function n(sql: string, params: unknown[]) {
  return Number((await client.query(sql, params)).rows[0].n);
}

describe('devices', () => {
  it('registers idempotently and only the owner can remove', async () => {
    const key = randomBytes(32);
    const a = await register(couple.profileIds[alice]!, key);
    expect(await register(couple.profileIds[alice]!, key)).toBe(a);
    await as(couple.profileIds[bob]!, () => client.query(`SELECT waves_remove_device($1)`, [a]));
    expect(await n(`SELECT count(*) n FROM e2ee_devices WHERE id = $1`, [a])).toBe(1);
    await as(couple.profileIds[alice]!, () => client.query(`SELECT waves_remove_device($1)`, [a]));
    expect(await n(`SELECT count(*) n FROM e2ee_devices WHERE id = $1`, [a])).toBe(0);
  });

  it('keeps a removed device key revoked for its profile only', async () => {
    const profile = couple.profileIds[alice]!;
    const otherProfile = couple.profileIds[bob]!;
    const removedKey = randomBytes(32);
    const removedId = await register(profile, removedKey);
    await as(profile, () => client.query(`SELECT waves_remove_device($1)`, [removedId]));

    await expect(register(profile, removedKey)).rejects.toThrow('DEVICE_REVOKED');
    expect(await register(profile, randomBytes(32))).toBeTruthy();
    expect(await register(otherProfile, removedKey)).toBeTruthy();
  });

  it('rejects a key that is not 32 bytes and direct writes', async () => {
    await expect(register(couple.profileIds[alice]!, randomBytes(31))).rejects.toThrow();
    await expectDenied(
      as(couple.profileIds[alice]!, () =>
        client.query(`INSERT INTO e2ee_devices (profile_id, public_key) VALUES ($1, $2::bytea)`, [
          couple.profileIds[alice],
          randomBytes(32),
        ]),
      ),
    );
  });

  it('caps registered devices at ten while allowing idempotent re-registration', async () => {
    const profile = couple.profileIds[alice]!;
    const firstKey = randomBytes(32);
    const first = await register(profile, firstKey);
    expect(await register(profile, firstKey)).toBe(first);
    for (let i = 1; i < 10; i++) await register(profile);
    await expect(register(profile)).rejects.toThrow('DEVICE_LIMIT_REACHED');
  });

  it('removing a device cascades its mailbox rows', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    await send(couple.profileIds[alice]!, couple.groupId, a, [
      { recipient_device: b, ciphertext: ct() },
    ]);
    await as(couple.profileIds[bob]!, () => client.query(`SELECT waves_remove_device($1)`, [b]));
    expect(
      await n(`SELECT count(*) n FROM group_mailbox WHERE group_id = $1`, [couple.groupId]),
    ).toBe(0);
  });

  it('group_devices works for live couple members only', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    const rows = await as(couple.profileIds[alice]!, () =>
      client.query(`SELECT * FROM waves_group_devices($1)`, [couple.groupId]),
    );
    expect(rows.rows.map((r) => r.device_id).sort()).toEqual([a, b].sort());
    // A trip group is not a household space.
    await expect(
      as(trip.profileIds[alice]!, () =>
        client.query(`SELECT * FROM waves_group_devices($1)`, [trip.groupId]),
      ),
    ).rejects.toThrow();
    // An outsider.
    await expect(
      as(trip.profileIds[bob]!, () =>
        client.query(`SELECT * FROM waves_group_devices($1)`, [couple.groupId]),
      ),
    ).rejects.toThrow();
  });
});

describe('send validation', () => {
  it('does not reinsert a delivery after the receiver acknowledged it', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    const deliveryId = randomUUID();
    const item = { recipient_device: b, ciphertext: ct(), delivery_id: deliveryId };
    expect((await send(couple.profileIds[alice]!, couple.groupId, a, [item])).rows[0].n).toBe(1);
    await as(couple.profileIds[bob]!, () => client.query('DELETE FROM group_mailbox'));
    expect((await send(couple.profileIds[alice]!, couple.groupId, a, [item])).rows[0].n).toBe(0);
    expect(
      await n('SELECT count(*) n FROM group_mailbox WHERE recipient_device_id = $1', [b]),
    ).toBe(0);
  });

  it('keeps sender profile retained-byte accounting after sender device deletion', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    await send(couple.profileIds[alice]!, couple.groupId, a, [
      { recipient_device: b, ciphertext: ct() },
    ]);
    await as(couple.profileIds[alice]!, () => client.query('SELECT waves_remove_device($1)', [a]));
    expect(
      await n('SELECT count(*) n FROM group_mailbox WHERE sender_profile_id = $1', [
        couple.profileIds[alice],
      ]),
    ).toBe(1);
  });

  it('delivers to partner and to own other device', async () => {
    const a1 = await register(couple.profileIds[alice]!);
    const a2 = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    const r = await send(couple.profileIds[alice]!, couple.groupId, a1, [
      { recipient_device: b, ciphertext: ct() },
      { recipient_device: a2, ciphertext: ct() },
    ]);
    expect(r.rows[0].n).toBe(2);
  });

  it('refuses a foreign sender device, non-member recipient, other group types, oversize, too many', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    const outsider = await register(trip.profileIds[alice]!);
    const item = (to: string, c = ct()) => ({ recipient_device: to, ciphertext: c });

    await expect(send(couple.profileIds[alice]!, couple.groupId, b, [item(b)])).rejects.toThrow();
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [item(outsider)]),
    ).rejects.toThrow();
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [item(randomUUID())]),
    ).rejects.toThrow();

    const ta = await register(trip.profileIds[alice]!);
    const tb = await register(trip.profileIds[bob]!);
    await expect(send(trip.profileIds[alice]!, trip.groupId, ta, [item(tb)])).rejects.toThrow();

    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [item(b, ct(65537))]),
    ).rejects.toThrow();
    const ok = await send(couple.profileIds[alice]!, couple.groupId, a, [item(b, ct(65536))]);
    expect(ok.rows[0].n).toBe(1);

    await expect(
      send(
        couple.profileIds[alice]!,
        couple.groupId,
        a,
        Array.from({ length: 201 }, () => item(b)),
      ),
    ).rejects.toThrow();
  });

  it('refuses a sender who is not in the group', async () => {
    const b = await register(couple.profileIds[bob]!);
    const x = await register(trip.profileIds[alice]!);
    await expect(
      send(trip.profileIds[alice]!, couple.groupId, x, [{ recipient_device: b, ciphertext: ct() }]),
    ).rejects.toThrow();
  });

  it('rejects duplicate recipients and calls over the aggregate ciphertext byte limit', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [
        { recipient_device: b, ciphertext: ct() },
        { recipient_device: b, ciphertext: ct() },
      ]),
    ).rejects.toThrow('DUPLICATE_RECIPIENT_DEVICE');
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [
        { recipient_device: b, ciphertext: ct(65536) },
        { recipient_device: a, ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
        { recipient_device: randomUUID(), ciphertext: ct(65536) },
      ]),
    ).rejects.toThrow('CALL_BYTES_LIMIT_EXCEEDED');
  });

  it('rejects sends that would exceed retained bytes per recipient device', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    // Seed the pending mailbox at the 8 MiB recipient ceiling.
    await client.query(
      `INSERT INTO group_mailbox(group_id, sender_device_id, sender_profile_id, recipient_device_id, ciphertext)
      SELECT $1, $2, $3, $4, decode(repeat('00', 65536), 'hex') FROM generate_series(1, 128)`,
      [couple.groupId, a, couple.profileIds[alice], b],
    );
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [
        { recipient_device: b, ciphertext: ct() },
      ]),
    ).rejects.toThrow('RECIPIENT_MAILBOX_BYTES_LIMIT_EXCEEDED');
  });

  it('rejects sends that would exceed retained bytes per sender profile', async () => {
    const a = await register(couple.profileIds[alice]!);
    const ownSecondDevice = await register(couple.profileIds[alice]!);
    const partnerDevices = await Promise.all(
      Array.from({ length: 4 }, () => register(couple.profileIds[bob]!)),
    );
    for (const device of partnerDevices) {
      await client.query(
        `INSERT INTO group_mailbox(group_id, sender_device_id, sender_profile_id, recipient_device_id, ciphertext)
        SELECT $1, $2, $3, $4, decode(repeat('00', 65536), 'hex') FROM generate_series(1, 128)`,
        [couple.groupId, a, couple.profileIds[alice], device],
      );
    }
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [
        { recipient_device: ownSecondDevice, ciphertext: ct() },
      ]),
    ).rejects.toThrow('SENDER_PROFILE_MAILBOX_BYTES_LIMIT_EXCEEDED');
  });
});

describe('mailbox access', () => {
  it('recipient sees and deletes only own rows; no direct insert', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    await send(couple.profileIds[alice]!, couple.groupId, a, [
      { recipient_device: b, ciphertext: ct() },
    ]);
    const seen = (p: string) =>
      as(p, () => client.query(`SELECT id FROM group_mailbox`)).then((r) => r.rows.length);
    expect(await seen(couple.profileIds[alice]!)).toBe(0);
    expect(await seen(couple.profileIds[bob]!)).toBe(1);

    await expectDenied(
      as(couple.profileIds[alice]!, () =>
        client.query(
          `INSERT INTO group_mailbox (group_id, recipient_device_id, ciphertext) VALUES ($1, $2, $3::bytea)`,
          [couple.groupId, b, randomBytes(4)],
        ),
      ),
    );
    await as(couple.profileIds[alice]!, () => client.query(`DELETE FROM group_mailbox`));
    expect(
      await n(`SELECT count(*) n FROM group_mailbox WHERE group_id = $1`, [couple.groupId]),
    ).toBe(1);
    await as(couple.profileIds[bob]!, () => client.query(`DELETE FROM group_mailbox`));
    expect(
      await n(`SELECT count(*) n FROM group_mailbox WHERE group_id = $1`, [couple.groupId]),
    ).toBe(0);
  });

  it('leaving deletes the leaver’s rows and stops delivery to them', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    await send(couple.profileIds[alice]!, couple.groupId, a, [
      { recipient_device: b, ciphertext: ct() },
    ]);
    await client.query(`UPDATE group_members SET left_at = now() WHERE id = $1`, [
      couple.memberIds[bob],
    ]);
    expect(
      await n(`SELECT count(*) n FROM group_mailbox WHERE group_id = $1`, [couple.groupId]),
    ).toBe(0);
    await expect(
      send(couple.profileIds[alice]!, couple.groupId, a, [
        { recipient_device: b, ciphertext: ct() },
      ]),
    ).rejects.toThrow();
  });
});

describe('rent hint', () => {
  it('notifies the partner, not the actor, without an amount, once per retry', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    const items = [{ recipient_device: b, ciphertext: ct() }];
    await send(couple.profileIds[alice]!, couple.groupId, a, items, 'rent_recorded');
    await send(couple.profileIds[alice]!, couple.groupId, a, items, 'rent_recorded');

    const rows = await client.query(
      `SELECT profile_id, title, body, payload FROM notifications WHERE group_id = $1 AND kind = 'rent_recorded'`,
      [couple.groupId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].profile_id).toBe(couple.profileIds[bob]);
    expect(
      JSON.stringify([rows.rows[0].title, rows.rows[0].body, rows.rows[0].payload]),
    ).not.toMatch(/amount|\d{3,}/);
    const act = await client.query(
      `SELECT payload FROM activity_log WHERE group_id = $1 AND verb = 'rent_recorded'`,
      [couple.groupId],
    );
    expect(act.rows).toHaveLength(1);
    expect(act.rows[0].payload).toEqual({});
  });

  it('deduplicates stable delivery ids and a logical rent event across resealed retries', async () => {
    const a = await register(couple.profileIds[alice]!);
    const b = await register(couple.profileIds[bob]!);
    const deliveryId = randomUUID();
    const eventId = randomUUID();
    await send(
      couple.profileIds[alice]!,
      couple.groupId,
      a,
      [{ recipient_device: b, ciphertext: ct(), delivery_id: deliveryId }],
      'rent_recorded',
      eventId,
    );
    await send(
      couple.profileIds[alice]!,
      couple.groupId,
      a,
      [{ recipient_device: b, ciphertext: ct(), delivery_id: deliveryId }],
      'rent_recorded',
      eventId,
    );
    expect(
      await n(`SELECT count(*) n FROM group_mailbox WHERE recipient_device_id = $1`, [b]),
    ).toBe(1);
    expect(
      await n(
        `SELECT count(*) n FROM notifications WHERE group_id = $1 AND kind = 'rent_recorded'`,
        [couple.groupId],
      ),
    ).toBe(1);
    expect(
      await n(
        `SELECT count(*) n FROM activity_log WHERE group_id = $1 AND verb = 'rent_recorded'`,
        [couple.groupId],
      ),
    ).toBe(1);
  });
});

describe('surface', () => {
  it('anon cannot execute any new function', async () => {
    for (const sig of [
      'waves_register_device(bytea)',
      'waves_remove_device(uuid)',
      'waves_group_devices(uuid)',
      'waves_mailbox_send(uuid, uuid, jsonb, text, text)',
    ]) {
      const r = await client.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok`, [
        `public.${sig}`,
      ]);
      expect(r.rows[0].ok, sig).toBe(false);
    }
    const oldSend = await client.query(
      `SELECT to_regprocedure('public.waves_mailbox_send(uuid,uuid,jsonb,text)') AS fn`,
    );
    expect(oldSend.rows[0].fn).toBeNull();
    const authSend = await client.query(
      `SELECT has_function_privilege('authenticated', 'public.waves_mailbox_send(uuid,uuid,jsonb,text,text)', 'EXECUTE') AS ok`,
    );
    expect(authSend.rows[0].ok).toBe(true);
  });

  it('group_records is gone', async () => {
    const r = await client.query(`SELECT to_regclass('public.group_records') AS t`);
    expect(r.rows[0].t).toBeNull();
  });
});
