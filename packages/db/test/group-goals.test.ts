/** Joint goals: write only through the functions, members only, total never below zero. */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { connect, seedGroup, type SeededGroup } from './helpers';

let client: Client;
let group: SeededGroup;
let other: SeededGroup;

beforeAll(async () => {
  client = await connect();
});
afterAll(async () => {
  await client.end();
});
beforeEach(async () => {
  group = await seedGroup(client, { memberCount: 2, name: 'Home' });
  other = await seedGroup(client, { memberCount: 1, name: 'Elsewhere' });
});

async function as<T>(profileId: string, run: () => Promise<T>): Promise<T> {
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: profileId, role: 'authenticated' }),
  ]);
  await client.query('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

async function setGoal(by: SeededGroup, who: number, id: string, plan: object = {}) {
  return as(by.profileIds[who]!, () =>
    client.query(
      `SELECT waves_set_group_goal($1, $2, 'House', '🏠', 1500000, 'INR', '2028-01-01', NULL, $3::jsonb)`,
      [by.groupId, id, JSON.stringify(plan)],
    ),
  );
}
const add = (by: SeededGroup, who: number, goal: string, amount: number, id = randomUUID()) =>
  as(by.profileIds[who]!, () =>
    client.query(`SELECT waves_add_goal_contribution($1, $2, $3, $4, '2026-12-01', NULL)`, [
      goal,
      id,
      by.memberIds[who],
      amount,
    ]),
  );
const total = async (goal: string) =>
  Number(
    (
      await client.query(
        `SELECT COALESCE(sum(amount_minor),0) AS t FROM group_goal_contributions WHERE goal_id=$1 AND deleted_at IS NULL`,
        [goal],
      )
    ).rows[0].t,
  );

describe('group goals', () => {
  it('creates idempotently, stamps a seq, and a member reads it', async () => {
    const id = randomUUID();
    await setGoal(group, 0, id, { [group.memberIds[0]!]: 500000 });
    await setGoal(group, 1, id, { [group.memberIds[0]!]: 600000 });
    const { rows } = await as(group.profileIds[1]!, () =>
      client.query(`SELECT * FROM group_goals WHERE group_id = $1`, [group.groupId]),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].updated_seq)).toBeGreaterThan(0);
    expect(rows[0].monthly_plan[group.memberIds[0]!]).toBe(600000);
  });

  it('refuses a non-member, a cross-group plan member, and direct writes', async () => {
    await expect(setGoal(group, 0, randomUUID(), { [other.memberIds[0]!]: 1 })).rejects.toThrow(
      /UNKNOWN_MEMBER/,
    );
    await expect(setGoal(other, 0, randomUUID())).resolves.toBeDefined();
    await expect(
      as(other.profileIds[0]!, () =>
        client.query(`SELECT waves_set_group_goal($1, $2, 'x', NULL, 5, 'INR', NULL, NULL, '{}')`, [
          group.groupId,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/NOT_A_MEMBER/);
    await expect(
      as(group.profileIds[0]!, () =>
        client.query(
          `INSERT INTO group_goals (id, group_id, name, target_minor, currency, created_by) VALUES ($1,$2,'x',5,'INR',$3)`,
          [randomUUID(), group.groupId, group.memberIds[0]],
        ),
      ),
    ).rejects.toThrow();
  });

  it('hides goals from non-members', async () => {
    await setGoal(group, 0, randomUUID());
    const { rows } = await as(other.profileIds[0]!, () =>
      client.query(`SELECT id FROM group_goals WHERE group_id = $1`, [group.groupId]),
    );
    expect(rows).toHaveLength(0);
  });

  it('adds idempotently, never lets the total go below zero, voids softly', async () => {
    const goal = randomUUID();
    await setGoal(group, 0, goal);
    const line = randomUUID();
    await add(group, 0, goal, 1000, line);
    await add(group, 0, goal, 1000, line);
    expect(await total(goal)).toBe(1000);
    await expect(add(group, 1, goal, -1500)).rejects.toThrow(/NOT_ENOUGH_ASIDE/);
    await add(group, 1, goal, -400);
    expect(await total(goal)).toBe(600);
    await expect(
      as(group.profileIds[0]!, () =>
        client.query(`SELECT waves_void_goal_contribution($1)`, [line]),
      ),
    ).rejects.toThrow(/NOT_ENOUGH_ASIDE/);
    await add(group, 0, goal, 500);
    await as(group.profileIds[0]!, () =>
      client.query(`SELECT waves_void_goal_contribution($1)`, [line]),
    );
    expect(await total(goal)).toBe(100);
  });

  it('blocks outsiders and archived goals; anon cannot execute', async () => {
    const goal = randomUUID();
    await setGoal(group, 0, goal);
    await expect(add(other, 0, goal, 5)).rejects.toThrow(/NO_SUCH_GOAL/);
    await as(group.profileIds[0]!, () =>
      client.query(`SELECT waves_archive_group_goal($1, 'archived')`, [goal]),
    );
    await expect(add(group, 0, goal, 5)).rejects.toThrow(/GOAL_ARCHIVED/);
    const { rows } = await client.query(
      `SELECT has_function_privilege('anon','public.waves_add_goal_contribution(uuid, uuid, uuid, bigint, date, text)','EXECUTE') AS ok`,
    );
    expect(rows[0].ok).toBe(false);
  });
});
