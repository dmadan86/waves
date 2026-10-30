import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

// Members: 0 owner, 1 manager A, 2 manager B, 3 employee (team of manager A), 4 vendor login (Ravi).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const ravi = randomUUID(); // owner-added, linked to member 4
const mine = randomUUID(); // added by manager A, name only
const other = randomUUID(); // added by manager B, name only

async function user<T>(i: number, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: g.profileIds[i], role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    return await run();
  } catch (error) {
    await db.query('ROLLBACK TO SAVEPOINT actor_scope');
    throw error;
  } finally {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims','',true)");
    await db.query('RELEASE SAVEPOINT actor_scope');
  }
}
async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}
async function denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}
const addVendor = (caller: number, id: string, name: string) =>
  user(caller, () =>
    db.query('SELECT waves_company_vendor_set($1,$2,$3)', [g.groupId, id, JSON.stringify({ name })]),
  );
const line = (caller: number, vendor: string, kind: string, amount: string, id = randomUUID()) =>
  user(caller, async () => {
    await db.query('SELECT waves_company_vendor_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      id,
      vendor,
      kind,
      JSON.stringify({ amount, occurredOn: '2026-11-10' }),
    ]);
    return id;
  });
beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  const roles = ['admin', 'manager', 'manager', 'member', 'vendor'];
  for (let i = 0; i < 5; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i === 3 ? g.memberIds[1] : null],
    );
  await db.query('BEGIN');
  await addVendor(0, ravi, 'Ravi Traders');
  await db.query('UPDATE company_vendors SET member_id=$1 WHERE id=$2', [g.memberIds[4], ravi]);
  await addVendor(1, mine, 'A Hardware');
  await addVendor(2, other, 'B Paints');
  await db.query('COMMIT');
});
afterAll(async () => {
  if (db) await db.end();
});


const path = (lineId: string) => `${lineId}/${randomUUID()}/${randomUUID()}.jpg`;
// The byte door runs as the service role on behalf of the caller's profile.
const reserve = (caller: number, key: string) =>
  db.query("SELECT waves_storage_reserve($1,$2,'company-entry-images',$3,100,'image/jpeg')", [g.profileIds[caller], g.groupId, key]);
const commit = (caller: number, key: string) =>
  db.query("SELECT waves_storage_record($1,$2,'company-entry-images',$3,100,'image/jpeg')", [g.profileIds[caller], g.groupId, key]);
/** Upload and attach one photo as `caller`; returns the attachment id. */
async function photo(caller: number, lineId: string) {
  const key = path(lineId);
  const id = key.split('/')[1]!;
  await reserve(caller, key);
  await commit(caller, key);
  await user(caller, () => db.query('SELECT waves_attach_company_vendor_entry_image($1,$2,$3)', [lineId, key, id]));
  return id;
}
const photosSeenBy = (caller: number) =>
  user(caller, async () => (await db.query('SELECT id FROM company_vendor_entry_attachments WHERE deleted_at IS NULL')).rows.map((r) => r.id as string));
const remove = (caller: number, id: string) =>
  user(caller, () => db.query('SELECT waves_remove_company_vendor_entry_image($1)', [id]));

describe('vendor line photos', () => {
  it('are visible only to who sees the line: owner, the vendor manager, that vendor', () =>
    isolated(async () => {
      const bill = await line(4, ravi, 'bill', '900'); // Ravi's own pending bill
      const ownerLine = await line(0, ravi, 'payment', '100');
      const managed = await line(1, mine, 'bill', '500');
      const a = await photo(4, bill);
      const b = await photo(0, ownerLine);
      const c = await photo(1, managed);
      expect((await photosSeenBy(0)).sort()).toEqual([a, b, c].sort());
      expect((await photosSeenBy(4)).sort()).toEqual([a, b].sort()); // not the other vendor's
      expect(await photosSeenBy(1)).toEqual([c]); // not Ravi's, the owner's vendor
      expect(await photosSeenBy(2)).toEqual([]);
      expect(await photosSeenBy(3)).toEqual([]);
    }));

  it('cannot be attached, uploaded or removed by someone who cannot see the line', () =>
    isolated(async () => {
      const bill = await line(4, ravi, 'bill', '900');
      const id = await photo(4, bill);
      for (const outsider of [1, 2, 3]) {
        const key = path(bill);
        await denied(() => reserve(outsider, key));
        await denied(() => remove(outsider, id));
        await denied(() => db.query('SELECT waves_attach_company_vendor_entry_image($1,$2,$3)', [bill, key, randomUUID()]));
      }
      expect(await photosSeenBy(0)).toEqual([id]);
    }));

  it('a vendor photographs only their own pending bill, and not after it is decided', () =>
    isolated(async () => {
      const bill = await line(4, ravi, 'bill', '900');
      const payment = await line(0, ravi, 'payment', '100');
      await denied(() => photo(4, payment)); // not a bill of theirs
      const mineId = await photo(4, bill);
      const ownerId = await photo(0, bill); // owner may add to it
      await denied(() => remove(4, ownerId)); // a vendor removes only their own
      await user(0, () => db.query('SELECT waves_company_vendor_entry_review($1,$2,$3,$4)', [bill, 'approved', null, 1]));
      await denied(() => photo(4, bill));
      await denied(() => remove(4, mineId));
      await remove(0, mineId); // the owner can
      expect(await photosSeenBy(0)).toEqual([ownerId]);
    }));

  it('are removed with a voided line, and nobody can write the table directly', () =>
    isolated(async () => {
      const managed = await line(1, mine, 'bill', '500');
      const id = await photo(1, managed);
      await denied(() =>
        user(0, () => db.query("INSERT INTO company_vendor_entry_attachments(id,entry_id,group_id,uploader_member_id,storage_path) VALUES($1,$2,$3,$4,$5)", [randomUUID(), managed, g.groupId, g.memberIds[0], path(managed)])),
      );
      await user(1, () => db.query('SELECT waves_company_vendor_entry_void($1,$2)', [managed, 'dup']));
      expect(await photosSeenBy(0)).toEqual([]);
      const left = await db.query("SELECT 1 FROM storage_objects WHERE logical_bucket='company-entry-images' AND split_part(path,'/',1)=$1", [managed]);
      expect(left.rowCount).toBe(0);
      expect(id).toBeTruthy();
    }));
});
