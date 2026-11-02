/** Paid extra companies: one owned company is free, each further one needs a bound monthly slot; a lapse is read-only. */

import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './helpers';

let db: Client;
const owner = randomUUID();
const employee = randomUUID();

async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await db.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await db.query('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}
const create = (who: string, id = randomUUID()) =>
  as(who, async () => {
    await db.query(`SELECT waves_create_group('Co','company','INR',NULL,false,$1)`, [id]);
    return id;
  });
const status = (who: string) =>
  as(who, async () => (await db.query('SELECT waves_company_slot_status() s')).rows[0].s);
const apply = async (txn: string, active: boolean, at: Date, user = owner, event = randomUUID()) =>
  (
    await db.query('SELECT waves_company_slot_apply($1,$2,$3,$4,$5) AS o', [
      event,
      'TEST',
      user,
      at,
      JSON.stringify({ kind: 'company_slot', store_txn_id: txn, active }),
    ])
  ).rows[0].o as string;
const lapsed = async (id: string) =>
  (await db.query('SELECT slot_lapsed_at IS NOT NULL l FROM groups WHERE id=$1', [id])).rows[0]
    .l as boolean;

beforeAll(async () => {
  db = await connect();
  for (const id of [owner, employee])
    await db.query(`INSERT INTO profiles(id,display_name,default_currency) VALUES($1,'P','INR')`, [
      id,
    ]);
});
afterAll(async () => {
  if (db) await db.end();
});

describe('company slots', () => {
  const t0 = Date.now();
  const txn = `GPA.${randomUUID()}`;
  let first: string;
  let second: string;

  it('first owned company is free; an employee role is never counted', async () => {
    first = await create(owner);
    await db.query(`INSERT INTO group_members(group_id,profile_id,role) VALUES($1,$2,'member')`, [
      first,
      employee,
    ]);
    expect(await status(employee)).toEqual({ needs_slot: false, has_free_slot: false });
    await create(employee); // own first company, free, despite being an employee elsewhere
    expect(await status(owner)).toEqual({ needs_slot: true, has_free_slot: false });
  });

  it('a second company needs a slot, through the RPC and a direct insert', async () => {
    await expect(create(owner)).rejects.toThrow(/COMPANY_SLOT_REQUIRED/);
    await expect(
      as(owner, () =>
        db.query(`INSERT INTO groups(id,type,created_by) VALUES($1,'company',$2)`, [
          randomUUID(),
          owner,
        ]),
      ),
    ).rejects.toThrow(/COMPANY_SLOT_REQUIRED/);
  });

  it('a purchased slot is claimed once and bound to the new company', async () => {
    expect(await apply(txn, true, new Date(t0))).toBe('applied');
    expect(await status(owner)).toEqual({ needs_slot: true, has_free_slot: true });
    second = await create(owner);
    expect(
      (await db.query('SELECT group_id g FROM company_slots WHERE store_txn_id=$1', [txn])).rows[0]
        .g,
    ).toBe(second);
    await expect(create(owner)).rejects.toThrow(/COMPANY_SLOT_REQUIRED/);
  });

  it('a lapse suspends the extra company only, never the free one; renewal lifts it', async () => {
    expect(await apply(txn, false, new Date(t0 + 1000))).toBe('applied');
    expect(await lapsed(second)).toBe(true);
    expect(await lapsed(first)).toBe(false);
    expect((await db.query('SELECT waves_company_is_blocked($1) b', [second])).rows[0].b).toBe(
      true,
    );
    // A member cannot lift it, and a stale event changes nothing.
    await expect(
      as(owner, () => db.query('UPDATE groups SET slot_lapsed_at=NULL WHERE id=$1', [second])),
    ).rejects.toThrow(/NOT_ALLOWED/);
    expect(await apply(txn, true, new Date(t0 + 500))).toBe('stale');
    expect(await lapsed(second)).toBe(true);
    expect(await apply(txn, true, new Date(t0 + 2000))).toBe('applied');
    expect(await lapsed(second)).toBe(false);
  });

  it('a new subscription renews a lapsed company; nobody else can', async () => {
    await apply(txn, false, new Date(t0 + 3000));
    expect(await lapsed(second)).toBe(true);
    const next = `GPA.${randomUUID()}`;
    await apply(next, true, new Date(t0 + 4000));
    expect(
      await as(
        employee,
        async () => (await db.query('SELECT waves_company_slot_renew($1) r', [second])).rows[0].r,
      ),
    ).toBe(false);
    expect(
      await as(
        owner,
        async () => (await db.query('SELECT waves_company_slot_renew($1) r', [second])).rows[0].r,
      ),
    ).toBe(true);
    expect(await lapsed(second)).toBe(false);
    expect((await status(owner)).has_free_slot).toBe(false);
  });

  it('dedupes an event and ignores an unknown user', async () => {
    const event = randomUUID();
    expect(await apply(`GPA.${randomUUID()}`, true, new Date(), owner, event)).toBe('applied');
    expect(await apply(`GPA.${randomUUID()}`, true, new Date(), owner, event)).toBe('duplicate');
    expect(await apply(`GPA.${randomUUID()}`, true, new Date(), randomUUID())).toBe('unknown_user');
  });
});
