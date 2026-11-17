/** Admin aggregates leave test accounts (and what they created) out. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { addEqualSplitExpense, connect, seedGroup } from './helpers.js';

let client: Client;
const marked: string[] = [];

beforeAll(async () => {
  client = await connect();
});

afterAll(async () => {
  await client?.query(`DELETE FROM public.test_accounts WHERE user_id = ANY($1)`, [marked]);
  await client?.end();
});

async function snapshot(country: string) {
  const one = async (sql: string, args: unknown[] = []) => (await client.query(sql, args)).rows[0];
  const o = await one(`SELECT * FROM public.waves_admin_overview()`);
  const d = await one(`SELECT * FROM public.waves_admin_daily(1)`);
  const k = await one(`SELECT * FROM public.waves_admin_kpis(1)`);
  const g = await one(`SELECT * FROM public.waves_admin_geo() WHERE country_code = $1`, [country]);
  const m = (await client.query(`SELECT * FROM public.waves_admin_money()`)).rows.find(
    (r) => r.currency === 'INR',
  );
  return {
    profiles: Number(o.profiles_total),
    profiles30: Number(o.profiles_new_30d),
    groups: Number(o.groups_total),
    expenses: Number(o.expenses_total),
    active7: Number(o.active_profiles_7d),
    dailyProfiles: Number(d.new_profiles),
    dailyGroups: Number(d.new_groups),
    dailyExpenses: Number(d.new_expenses),
    dailyActive: Number(d.active_profiles),
    registrations: Number(k.registrations),
    geoProfiles: Number(g.profile_count),
    geoGroups: Number(g.group_count),
    geoExpenses: Number(g.expense_count),
    moneyExpenses: Number(m?.expense_count ?? 0),
  };
}

describe('admin aggregates exclude test accounts', () => {
  it('drops the test user and what they created, and nothing else', async () => {
    const country = 'ZZ';
    const seed = async () => {
      const s = await seedGroup(client, { memberCount: 1 });
      await client.query(`UPDATE profiles SET country_code = $2 WHERE id = $1`, [
        s.profileIds[0],
        country,
      ]);
      await client.query(`UPDATE groups SET country_code = $2 WHERE id = $1`, [s.groupId, country]);
      await addEqualSplitExpense(client, {
        groupId: s.groupId,
        payers: { [s.memberIds[0]!]: 100n },
        participants: [s.memberIds[0]!],
        amount: 100n,
      });
      await client.query(
        `INSERT INTO activity_log (group_id, actor_member_id, verb, object_type)
         VALUES ($1, $2, 'expense_added', 'expense')`,
        [s.groupId, s.memberIds[0]],
      );
      return s;
    };
    await seed(); // a real customer
    const test = await seed();

    const before = await snapshot(country);
    marked.push(test.profileIds[0]!);
    await client.query(`INSERT INTO public.test_accounts (user_id) VALUES ($1)`, [
      test.profileIds[0],
    ]);
    const after = await snapshot(country);

    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      expect(before[key] - after[key], key).toBe(1);
    }
  });
});
