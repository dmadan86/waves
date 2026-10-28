import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { asRole, connect, expectDenied, seedGroup } from './helpers.js';

let client: Client;
let normal: Awaited<ReturnType<typeof seedGroup>>;
const source = randomUUID();
const target = randomUUID();
const employeeCompany = randomUUID();
const ghost = randomUUID();
const real = randomUUID();
const hidden = randomUUID();
const adminMember = randomUUID();
const targetEmployee = randomUUID();
const phone = '+919876543210';
const email = `past-${randomUUID()}@example.test`;
const user = <T>(actor: number, run: () => Promise<T>) =>
  asRole(client, 'authenticated', { sub: normal.profileIds[actor], role: 'authenticated' }, run);
const list = (group = target) => client.query('SELECT * FROM waves_company_past_people($1)', [group]);
const add = (ids: string[], group = target) =>
  client.query('SELECT * FROM waves_company_add_past_people($1,$2::uuid[])', [group, ids]);

beforeAll(async () => {
  client = await connect();
  normal = await seedGroup(client, { memberCount: 4, ghostCount: 1 });
  for (const [id, name] of [[source, 'A'], [target, 'B'], [employeeCompany, 'C']]) {
    await client.query(
      "INSERT INTO groups(id,name,type,default_currency,created_by) VALUES($1,$2,'company','INR',$3)",
      [id, name, normal.profileIds[0]],
    );
    await client.query(
      'INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)',
      [id === target ? adminMember : randomUUID(), id, normal.profileIds[0],
        id === employeeCompany ? 'member' : 'admin'],
    );
  }
  await client.query(
    "INSERT INTO group_members(id,group_id,profile_id) VALUES($1,$2,$3),($4,$5,$6)",
    [real, source, normal.profileIds[1], targetEmployee, target, normal.profileIds[2]],
  );
  await client.query(
    `INSERT INTO group_members(id,group_id,ghost_name,invite_phone,invite_email)
     VALUES($1,$2,'Past colleague',$3,$4),($5,$6,'Private colleague',NULL,NULL)`,
    [ghost, source, phone, email, hidden, employeeCompany],
  );
});
afterAll(async () => {
  if (client) await client.end();
});

describe('company past people', () => {
  it.each([2, 3])('requires a target admin for both RPCs (actor %i)', async (actor) => {
    expect(await expectDenied(user(actor, () => list()))).toMatch(/ADMIN_ONLY/);
    expect(await expectDenied(user(actor, () => add([ghost])))).toMatch(/ADMIN_ONLY/);
  });

  it('requires a company target even for an ordinary group admin', async () => {
    expect(await expectDenied(user(0, () => list(normal.groupId)))).toMatch(/ADMIN_ONLY/);
    expect(await expectDenied(user(0, () => add([ghost], normal.groupId)))).toMatch(/ADMIN_ONLY/);
  });

  it('lists only other administered company people and membership contacts', async () => {
    await user(0, async () => {
      const { rows } = await list();
      expect(rows.map((r) => r.source_member_id).sort()).toEqual([ghost, real].sort());
      expect(rows.find((r) => r.source_member_id === ghost)).toMatchObject({
        source_group_id: source, source_group_name: 'A', profile_id: null,
        display_name: 'Past colleague', phone, email, is_placeholder: true,
      });
      expect(rows.find((r) => r.source_member_id === real)).toMatchObject({
        profile_id: normal.profileIds[1], display_name: 'Member 2',
        phone: null, email: null, is_placeholder: false,
      });
    });
  });

  it.each([hidden, randomUUID()])('refuses inaccessible or missing source %s atomically', async (id) => {
    expect(await expectDenied(user(0, () => add([ghost, id])))).toBe('FORBIDDEN');
    expect((await client.query(
      'SELECT id FROM group_members WHERE group_id=$1 AND invite_email=$2', [target, email],
    )).rowCount).toBe(0);
  });

  it('refuses non-company source members', async () => {
    expect(await expectDenied(user(0, () => add([normal.memberIds[4]!])))).toBe('FORBIDDEN');
  });

  it('limits batches to 100 ids', async () => {
    await expect(user(0, () => add(Array.from({ length: 101 }, () => ghost))))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('links real profiles, copies ghosts, excludes additions and returns existing ids on replay', async () => {
    await user(0, async () => {
      const { rows } = await add([real, ghost]);
      expect(rows).toHaveLength(2);
      const realId = rows.find((r) => r.source_member_id === real)!.member_id;
      const ghostId = rows.find((r) => r.source_member_id === ghost)!.member_id;
      expect((await client.query('SELECT profile_id FROM group_members WHERE id=$1', [realId]))
        .rows[0].profile_id).toBe(normal.profileIds[1]);
      expect((await client.query(
        'SELECT profile_id,ghost_name,invite_phone,invite_email FROM group_members WHERE id=$1',
        [ghostId],
      )).rows[0]).toEqual({ profile_id: null, ghost_name: 'Past colleague', invite_phone: phone, invite_email: email });
      expect((await list()).rows).toEqual([]);
      expect((await add([real, ghost])).rows).toEqual(rows);
    });
  });

  it.each(['invite_phone', 'invite_email'])('excludes existing target contacts by %s', async (column) => {
    await user(0, async () => {
      await client.query(
        `INSERT INTO group_members(group_id,ghost_name,${column}) VALUES($1,'Already here',$2)`,
        [target, column === 'invite_phone' ? phone : email],
      );
      expect((await list()).rows.map((r) => r.source_member_id)).not.toContain(ghost);
    });
  });

  it('does not pass a phone without a country prefix to the add RPC', async () => {
    await client.query('UPDATE group_members SET invite_phone=$1 WHERE id=$2', ['9876543210', ghost]);
    try {
      await user(0, async () => {
        const { rows } = await add([ghost]);
        expect((await client.query('SELECT invite_phone FROM group_members WHERE id=$1',
          [rows[0].member_id])).rows[0].invite_phone).toBeNull();
      });
    } finally {
      await client.query('UPDATE group_members SET invite_phone=$1 WHERE id=$2', [phone, ghost]);
    }
  });

  it('denies anonymous execution and pins definer grants', async () => {
    for (const run of [() => list(), () => add([ghost])]) {
      expect(await expectDenied(asRole(client, 'anon', { role: 'anon' }, run)))
        .toMatch(/permission denied/i);
    }
    const { rows } = await client.query(`SELECT prosecdef, proconfig,
      has_function_privilege('anon',oid,'EXECUTE') AS anon,
      has_function_privilege('authenticated',oid,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',oid,'EXECUTE') AS service
      FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('waves_company_past_people','waves_company_add_past_people')`);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ prosecdef: true, anon: false, authenticated: true, service: true });
      expect(row.proconfig).toContain('search_path=public, pg_temp');
    }
  });

  it('allows claiming a company placeholder with its ledger, while refusing merges', async () => {
    const arrival = randomUUID();
    const entry = randomUUID();
    await client.query("INSERT INTO profiles(id,display_name) VALUES($1,'Arrival')", [arrival]);
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: normal.profileIds[0], role: 'authenticated' }),
    ]);
    try {
      await client.query(`SELECT waves_company_entry_create($1,$2,$3,'expense',
        '{"amount":"100","occurredOn":"2026-11-06"}'::jsonb)`, [source, entry, ghost]);
      expect(await expectDenied(user(0, () => client.query(
        'SELECT waves_merge_member_into($1,$2)', [ghost, real],
      )))).toMatch(/COMPANY_GROUP/);
      expect(await expectDenied(client.query(
        'UPDATE group_members SET merged_into_member_id=$1 WHERE id=$2', [real, ghost],
      ))).toMatch(/COMPANY_GROUP/);
      const claim = (await client.query('SELECT waves_request_member_claim($1,$2,$3,NULL) AS v',
        [source, ghost, arrival])).rows[0].v;
      expect(claim.ok).toBe(true);
      await user(0, async () => {
        expect((await client.query('SELECT waves_decide_member_claim($1,true) AS v',
          [claim.claim_id])).rows[0].v).toMatchObject({ ok: true, status: 'approved' });
        expect((await client.query('SELECT id,profile_id FROM group_members WHERE id=$1', [ghost]))
          .rows[0]).toEqual({ id: ghost, profile_id: arrival });
        expect((await client.query('SELECT member_id FROM company_entries WHERE id=$1', [entry]))
          .rows[0].member_id).toBe(ghost);
      });
    } finally {
      await client.query("SELECT set_config('request.jwt.claims','',false)");
    }
  });
});
