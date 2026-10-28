import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, expectDenied, seedGroup } from './helpers';

let db: Client;
let g: Awaited<ReturnType<typeof seedGroup>>;
const user = async <T>(i: number, run: () => Promise<T>): Promise<T> => {
  const previous = (
    await db.query(
      "SELECT current_setting('role') AS role, current_setting('request.jwt.claims',true) AS claims",
    )
  ).rows[0];
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
    await db.query(previous.role === 'none' ? 'RESET ROLE' : `SET LOCAL ROLE ${previous.role}`);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [previous.claims ?? '']);
    await db.query('RELEASE SAVEPOINT actor_scope');
  }
};
const admin = <T>(run: () => Promise<T>) => user(0, run);
const entry = async (
  data: Record<string, unknown> = {},
  kind = 'expense',
  member = g.memberIds[1],
) => {
  const id = randomUUID();
  await db.query('SELECT waves_company_entry_create($1,$2,$3,$4,$5)', [
    g.groupId,
    id,
    member,
    kind,
    JSON.stringify({ amount: '100', occurredOn: '2026-11-10', ...data }),
  ]);
  return id;
};
// Isolate tests with rollback; no production connection variables are consulted by connect().
async function isolated(run: () => Promise<void>) {
  await db.query('BEGIN');
  try {
    await run();
  } finally {
    await db.query('ROLLBACK');
  }
}
// A failing statement inside our test transaction needs its own savepoint.
async function denied(run: () => Promise<unknown>) {
  await db.query('SAVEPOINT expected_failure');
  try {
    return await expectDenied(run());
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

beforeAll(async () => {
  db = await connect();
  const seed = await seedGroup(db, { memberCount: 4 });
  g = { ...seed, groupId: randomUUID(), memberIds: seed.memberIds.map(() => randomUUID()) };
  await db.query(
    "INSERT INTO groups(id,type,default_currency,country_code,created_by) VALUES($1,'company','INR','IN',$2)",
    [g.groupId, g.profileIds[0]],
  );
  for (let i = 0; i < 3; i++)
    await db.query('INSERT INTO group_members(id,group_id,profile_id,role) VALUES($1,$2,$3,$4)', [
      g.memberIds[i],
      g.groupId,
      g.profileIds[i],
      i === 0 ? 'admin' : 'member',
    ]);
});
afterAll(async () => {
  if (db) await db.end();
});

const add = (key: string, label = key) =>
  db.query('SELECT waves_company_tag_add($1,$2,$3)', [g.groupId, key, label]);
const set = (tags: unknown[], industry: string | null = null) =>
  db.query('SELECT waves_company_tags_set($1,$2,$3)', [g.groupId, JSON.stringify(tags), industry]);
const tags = async () =>
  (await db.query('SELECT company_tags FROM groups WHERE id=$1', [g.groupId])).rows[0]
    ?.company_tags;

describe('company tags', () => {
  it('grants application RPCs only to authenticated and service roles', async () => {
    for (const signature of [
      'waves_company_tag_add(uuid,text,text,text)',
      'waves_company_tags_set(uuid,jsonb,text)',
    ]) {
      const r = (
        await db.query(
          `SELECT prosecdef,proconfig,
        has_function_privilege('authenticated',oid,'EXECUTE') AS auth,
        has_function_privilege('anon',oid,'EXECUTE') AS anon,
        has_function_privilege('service_role',oid,'EXECUTE') AS service
        FROM pg_proc WHERE oid=$1::regprocedure`,
          [signature],
        )
      ).rows[0];
      expect(r).toMatchObject({ prosecdef: true, auth: true, anon: false, service: true });
      expect(r.proconfig).toContain('search_path=public, pg_temp');
    }
  });
  it('members add and read shared tags; outsiders cannot add or read; employees cannot set', () =>
    isolated(async () => {
      await user(1, () => add('cement', 'Cement'));
      expect(await user(2, tags)).toEqual([
        { key: 'cement', label: 'Cement', addedBy: g.memberIds[1] },
      ]);
      await denied(() => user(3, () => add('sand')));
      expect(await user(3, tags)).toBeUndefined();
      await denied(() => user(1, () => set([])));
    }));
  it('admin renames/hides, with idempotent hidden keys and case insensitive labels', () =>
    isolated(async () => {
      await user(1, () => add('cement', 'Cement'));
      await admin(() =>
        set([{ key: 'cement', label: 'Cement sacks', hidden: true, unit: 'bag' }], 'construction'),
      );
      await user(2, () => add('cement', 'Replacement'));
      await user(2, () => add('another', 'cEmEnT sAcKs'));
      expect(await tags()).toHaveLength(1);
      await denied(() => admin(() => set([])));
      await denied(() => admin(() => set([{ key: 'cement', label: 'Cement' }], 'agriculture')));
    }));
  it('caps at fifty and validates shape, keys and units', () =>
    isolated(async () => {
      const full = Array.from({ length: 50 }, (_, i) => ({ key: `t-${i}`, label: `Tag ${i}` }));
      await admin(() => set(full));
      await user(1, () => add('overflow'));
      expect(await tags()).toHaveLength(50);
      await denied(() => admin(() => set([...full, { key: 'overflow', label: 'Overflow' }])));
      for (const bad of [
        [{ key: 'BAD', label: 'Bad' }],
        [{ key: 'a', label: 'a', hidden: 'yes' }],
        [{ key: 'a', label: 'a', unit: 'x'.repeat(17) }],
        [
          { key: 'a', label: 'a' },
          { key: 'a', label: 'b' },
        ],
      ])
        await denied(() => admin(() => set(bad)));
    }));
  it('blocks direct admin writes and keeps phase-3 settings protected', () =>
    isolated(async () => {
      await denied(() =>
        admin(() =>
          db.query('UPDATE groups SET company_tags=\'[{"key":"x","label":"X"}]\' WHERE id=$1', [
            g.groupId,
          ]),
        ),
      );
      await denied(() =>
        admin(() =>
          db.query("UPDATE groups SET company_industry='transport' WHERE id=$1", [g.groupId]),
        ),
      );
      await denied(() =>
        admin(() =>
          db.query('UPDATE groups SET company_policy_revision=99 WHERE id=$1', [g.groupId]),
        ),
      );
    }));
  it('accepts unregistered custom entry keys, rejects malformed keys and preserves entry privacy', () =>
    isolated(async () => {
      const id = await user(1, () => entry({ category: 'cement-bags' }));
      await user(2, () => entry({ category: 'sand' }, 'expense', g.memberIds[2]));
      expect(
        (
          await user(1, () =>
            db.query('SELECT id FROM company_entries WHERE group_id=$1', [g.groupId]),
          )
        ).rows,
      ).toEqual([{ id }]);
      expect(
        (
          await admin(() =>
            db.query('SELECT id FROM company_entries WHERE group_id=$1', [g.groupId]),
          )
        ).rowCount,
      ).toBe(2);
      for (const category of ['Bad Key', '', '-cement', 'x'.repeat(41)])
        await denied(() => user(1, () => entry({ category })));
    }));
  it('enforces a phase-3 policy targeting an unregistered custom key', () =>
    isolated(async () => {
      await admin(() =>
        db.query('SELECT waves_company_policies_set($1,$2,0)', [
          g.groupId,
          JSON.stringify({
            version: 1,
            rules: [
              {
                id: 'cement-limit',
                type: 'period_limit',
                target: 'cement-bags',
                period: 'month',
                effect: 'block',
                limitMinor: '100',
              },
            ],
          }),
        ]),
      );
      await user(1, () => entry({ category: 'cement-bags', amount: '100' }));
      await denied(() => user(1, () => entry({ category: 'cement-bags', amount: '1' })));
    }));
});
