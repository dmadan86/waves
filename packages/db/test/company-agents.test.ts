/**
 * An AI assistant inside a company: bound to exactly one, switched off by the owner, held for approval.
 *
 * A Supabase OAuth token carries `client_id` and nothing about a company, so the binding is a row written at consent
 * and every company tool opens with `waves_company_agent_gate`. These pin the properties the owner is promised: the
 * gate bites on the very next call (off, revoked, suspended, left), a connection never reaches a second company, an
 * assistant cannot bind itself, and what it writes waits for review while that switch is on.
 */

import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connect, expectDenied, seedGroup } from './helpers';

// Profiles: 0 owner (also owner of `other`), 1 manager, 2 employee A, 3 employee B, 4 stranger (member of nothing).
let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
let other: string;
const CLIENT = 'assistant-one';
const today = new Date().toISOString().slice(0, 10);

/** Run as person `i`; with `agent` set the token carries that OAuth client, as Supabase mints it. */
async function as<T>(i: number, agent: string | null, run: () => Promise<T>): Promise<T> {
  await db.query('SAVEPOINT actor_scope');
  try {
    const claims: Record<string, unknown> = { sub: g.profileIds[i], role: 'authenticated' };
    if (agent) claims.client_id = agent;
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
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
async function denied(run: () => Promise<unknown>): Promise<string> {
  await db.query('SAVEPOINT expected_failure');
  try {
    return await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

const settings = (enabled: boolean, approval = true, group = g.groupId) =>
  as(0, null, () =>
    db.query('SELECT waves_company_agent_settings_set($1,$2,$3)', [group, enabled, approval]),
  );
const link = (i: number, group: string | null = g.groupId, client = CLIENT) =>
  as(i, null, () => db.query('SELECT waves_company_agent_link($1,$2)', [group, client]));
const gate = async (i: number, group = g.groupId, client = CLIENT) =>
  (
    await as(i, client, () => db.query('SELECT waves_company_agent_gate($1) AS role', [group]))
  ).rows[0].role as string;
const enableAndLink = async (i = 0) => {
  await settings(true);
  await link(i);
};
const addEntry = (i: number, agent: string | null, id = randomUUID(), member = 2) =>
  as(i, agent, async () => {
    await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
      g.groupId,
      id,
      g.memberIds[member],
      'expense',
      JSON.stringify({ amount: '12500', category: 'fuel', occurredOn: today }),
    ]);
    return id;
  });
const statusOf = async (id: string) =>
  (await db.query('SELECT status FROM company_entries WHERE id=$1', [id])).rows[0].status as string;

beforeAll(async () => {
  db = await connect();
  g = await seedGroup(db, { memberCount: 5 });
  await db.query('DELETE FROM groups WHERE id=$1', [g.groupId]);
  g.groupId = randomUUID();
  other = randomUUID();
  for (const id of [g.groupId, other])
    await db.query(
      "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
      [id, g.profileIds[0]],
    );
  const roles = ['admin', 'manager', 'member', 'member'];
  for (let i = 0; i < 4; i++)
    await db.query(
      'INSERT INTO group_members(id,group_id,profile_id,role,manager_id) VALUES($1,$2,$3,$4,$5)',
      [g.memberIds[i], g.groupId, g.profileIds[i], roles[i], i >= 2 ? g.memberIds[1] : null],
    );
  await db.query(
    "INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,'admin')",
    [randomUUID(), other, g.profileIds[0]],
  );
});
afterAll(async () => {
  if (db) await db.end();
});

describe('binding an assistant to a company', () => {
  it('needs the owner to have allowed agents, and the person to be a member', () =>
    isolated(async () => {
      expect(await denied(() => link(0))).toMatch(/AGENTS_OFF/);
      await settings(true);
      expect(await denied(() => link(4))).toMatch(/NOT_A_MEMBER/);
      await link(2);
      expect(await gate(2)).toBe('member');
    }));

  it('cannot be done by an assistant on its own token', () =>
    isolated(async () => {
      await settings(true);
      const message = await denied(() =>
        as(0, CLIENT, () =>
          db.query('SELECT waves_company_agent_link($1,$2)', [g.groupId, CLIENT]),
        ),
      );
      expect(message).toMatch(/NOT_ALLOWED/);
    }));

  it('is moved, not duplicated, when the same assistant is connected to another company', () =>
    isolated(async () => {
      await settings(true);
      await settings(true, true, other);
      await link(0, g.groupId);
      expect(await gate(0, g.groupId)).toBe('admin');
      await link(0, other);
      expect(await denied(() => gate(0, g.groupId))).toMatch(/NOT_LINKED/);
      expect(await gate(0, other)).toBe('admin');
      expect(
        (await db.query('SELECT 1 FROM company_agent_links WHERE profile_id=$1', [g.profileIds[0]]))
          .rowCount,
      ).toBe(1);
    }));

  it('connecting with no company unbinds a previous one', () =>
    isolated(async () => {
      await enableAndLink();
      await link(0, null);
      expect(await denied(() => gate(0))).toMatch(/NOT_LINKED/);
    }));
});

describe('the gate', () => {
  it('returns the role the person holds now', () =>
    isolated(async () => {
      await settings(true);
      await link(0);
      await link(1, g.groupId, 'assistant-two');
      expect(await gate(0)).toBe('admin');
      expect(await gate(1, g.groupId, 'assistant-two')).toBe('manager');
      await link(2, g.groupId, 'assistant-three');
      expect(await gate(2, g.groupId, 'assistant-three')).toBe('member');
    }));

  it('refuses a company the assistant is not bound to, and the app itself', () =>
    isolated(async () => {
      await enableAndLink();
      await settings(true, true, other);
      expect(await denied(() => gate(0, other))).toMatch(/NOT_LINKED/);
      expect(await denied(() => gate(0, g.groupId, 'someone-else'))).toMatch(/NOT_LINKED/);
      expect(
        await denied(() => as(0, null, () => db.query('SELECT waves_company_agent_gate($1)', [g.groupId]))),
      ).toMatch(/NOT_LINKED/);
    }));

  it('bites on the next call once the owner switches agents off', () =>
    isolated(async () => {
      await enableAndLink();
      await gate(0);
      await settings(false);
      expect(await denied(() => gate(0))).toMatch(/AGENTS_OFF/);
      await settings(true);
      expect(await gate(0)).toBe('admin');
    }));

  it('bites once the connection is revoked, by the owner or by the person', () =>
    isolated(async () => {
      await settings(true);
      await link(2);
      const id = (await db.query('SELECT id FROM company_agent_links')).rows[0].id;
      expect(await denied(() => as(3, null, () => db.query('SELECT waves_company_agent_link_revoke($1)', [id])))).toMatch(
        /NOT_ALLOWED/,
      );
      await as(0, null, () => db.query('SELECT waves_company_agent_link_revoke($1)', [id]));
      expect(await denied(() => gate(2))).toMatch(/NOT_LINKED/);
      await link(2); // connecting again restores it
      await as(2, null, () => db.query('SELECT waves_company_agent_link_revoke($1)', [id]));
      expect(await denied(() => gate(2))).toMatch(/NOT_LINKED/);
    }));

  it('bites once the company is suspended or the person has left', () =>
    isolated(async () => {
      await enableAndLink(2);
      await db.query('UPDATE groups SET suspended_at=now() WHERE id=$1', [g.groupId]);
      expect(await denied(() => gate(2))).toMatch(/AGENTS_OFF/);
      await db.query('UPDATE groups SET suspended_at=NULL WHERE id=$1', [g.groupId]);
      expect(await gate(2)).toBe('member');
      await db.query('UPDATE group_members SET left_at=now() WHERE id=$1', [g.memberIds[2]]);
      expect(await denied(() => gate(2))).toMatch(/NOT_LINKED/);
    }));

  it('is rate limited per company and assistant', () =>
    isolated(async () => {
      await enableAndLink();
      await db.query(
        "INSERT INTO app_config(key,value,description) VALUES('agent_company_rpm',2,'test') ON CONFLICT (key) DO UPDATE SET value=2",
      );
      await gate(0);
      await gate(0);
      expect(await denied(() => gate(0))).toMatch(/RATE_LIMITED/);
    }));
});

describe('owner controls', () => {
  it('only the owner changes the switches and sees connections', () =>
    isolated(async () => {
      const as1 = (fn: string, ...args: unknown[]) =>
        as(1, null, () => db.query(`SELECT ${fn}`, args));
      expect(await denied(() => as1('waves_company_agent_settings_set($1,true,true)', g.groupId))).toMatch(
        /ADMIN_ONLY/,
      );
      expect(await denied(() => as1('waves_company_agent_links_list($1)', g.groupId))).toMatch(/ADMIN_ONLY/);
      await enableAndLink(2);
      const listed = (
        await as(0, null, () => db.query('SELECT waves_company_agent_links_list($1) AS l', [g.groupId]))
      ).rows[0].l;
      expect(listed).toMatchObject({ enabled: true, approval: true });
      expect(listed.links).toHaveLength(1);
      expect(listed.links[0]).toMatchObject({ clientId: CLIENT, name: 'Member 3' });
    }));

  it('an assistant cannot flip the switches itself', () =>
    isolated(async () => {
      expect(
        await denied(() =>
          as(0, CLIENT, () =>
            db.query('SELECT waves_company_agent_settings_set($1,true,false)', [g.groupId]),
          ),
        ),
      ).toMatch(/NOT_ALLOWED/);
    }));

  it('direct writes to the link table and the switches are refused', () =>
    isolated(async () => {
      await enableAndLink();
      await denied(() =>
        as(0, null, () =>
          db.query("INSERT INTO company_agent_links(group_id,profile_id,client_id) VALUES($1,$2,'x')", [
            g.groupId,
            g.profileIds[0],
          ]),
        ),
      );
      await denied(() =>
        as(0, null, () => db.query('UPDATE groups SET company_agents_enabled=false WHERE id=$1', [g.groupId])),
      );
    }));

  it('a person sees only their own links', () =>
    isolated(async () => {
      await settings(true);
      await link(0);
      await link(2);
      const own = await as(2, null, () => db.query('SELECT profile_id FROM company_agent_links'));
      expect(own.rows.map((r) => r.profile_id)).toEqual([g.profileIds[2]]);
    }));

  it('lists the agent writes of the company to owner and manager, not an employee', () =>
    isolated(async () => {
      await enableAndLink(2);
      await as(2, CLIENT, () =>
        db.query("SELECT waves_record_agent_write('company_entry.add',$1,$2,12500,'INR')", [g.groupId, randomUUID()]),
      );
      const rows = (i: number) =>
        as(i, null, () => db.query('SELECT * FROM waves_company_agent_writes($1,10)', [g.groupId]));
      expect((await rows(0)).rows).toHaveLength(1);
      expect((await rows(1)).rows[0]).toMatchObject({ action: 'company_entry.add', person: 'Member 3' });
      expect(await denied(() => rows(2))).toMatch(/NOT_ALLOWED/);
      expect(await denied(() => rows(4))).toMatch(/NOT_A_MEMBER/);
    }));
});

describe('what an assistant writes', () => {
  it('is held for approval while the agent switch is on, even with company approvals off', () =>
    isolated(async () => {
      await enableAndLink(2);
      expect(await statusOf(await addEntry(2, CLIENT))).toBe('submitted');
    }));

  it('is approved straight away when the owner turns the switch off', () =>
    isolated(async () => {
      await settings(true, false);
      expect(await statusOf(await addEntry(2, CLIENT))).toBe('approved');
    }));

  it('leaves the app untouched: the same entry typed by hand is approved', () =>
    isolated(async () => {
      await settings(true, true);
      expect(await statusOf(await addEntry(2, null))).toBe('approved');
    }));

  it('stays held when company approvals are on, whatever the agent switch says', () =>
    isolated(async () => {
      await settings(true, false);
      await db.query('UPDATE groups SET company_approvals_enabled=true WHERE id=$1', [g.groupId]);
      expect(await statusOf(await addEntry(2, CLIENT))).toBe('submitted');
    }));

  it('cannot be written for a colleague by an employee (the RPC still decides)', () =>
    isolated(async () => {
      await enableAndLink(2);
      expect(await denied(() => addEntry(2, CLIENT, randomUUID(), 3))).toMatch(/NOT_ALLOWED/);
    }));

  it('reads are trimmed by RLS as for the person: an employee sees only their own entries', () =>
    isolated(async () => {
      await settings(true, false);
      await addEntry(2, null, randomUUID(), 2);
      await addEntry(3, null, randomUUID(), 3);
      const seen = (i: number) =>
        as(i, CLIENT, async () => (await db.query('SELECT member_id FROM company_entries')).rows.map((r) => r.member_id));
      expect(await seen(2)).toEqual([g.memberIds[2]]);
      expect(await seen(3)).toEqual([g.memberIds[3]]);
      expect(await seen(0)).toHaveLength(2);
    }));
});
