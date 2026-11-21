/** Joint goals cross the sync boundary as four mutation kinds; the payload is client JSON, so it is validated before an RPC. */

import { describe, expect, it, vi } from 'vitest';

import { SyncSession } from './index.ts';

const OWNER = 'owner-profile-id';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const MEMBER_ID = '11111111-2222-3333-4444-555555555555';

function caller() {
  const rpc = vi.fn((name: string) =>
    Promise.resolve({ data: name === 'waves_my_member_id' ? MEMBER_ID : {}, error: null }),
  );
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { rpc, from } as never, rpc };
}

function service() {
  const insert = vi.fn(() => Promise.resolve({ error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = { insert };
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  });
  return { client: { from } as never };
}

function mutation(kind: string, payload: Record<string, unknown>) {
  return {
    clientMutationId: kind,
    kind,
    groupId: GROUP_ID,
    seq: 1,
    clientCreatedAt: '2026-10-19T04:00:00.000Z',
    payload,
  } as never;
}

const GOAL = '00000000-0000-4000-8000-0000000000bb';
const LINE = '00000000-0000-4000-8000-0000000000cc';
const set = {
  goalId: GOAL,
  name: 'House',
  emoji: '🏠',
  targetMinor: '1500000',
  currency: 'INR',
  targetDate: '2028-01-01',
  forMemberId: null,
  monthlyPlan: { [MEMBER_ID]: 200000 },
};
const add = {
  contributionId: LINE,
  goalId: GOAL,
  memberId: MEMBER_ID,
  amountMinor: '-5000',
  date: '2026-12-01',
};

async function run(kind: string, payload: Record<string, unknown>) {
  const scoped = caller();
  const session = new SyncSession(scoped.client, service().client, OWNER);
  return { outcome: await session.apply(mutation(kind, payload)), rpc: scoped.rpc };
}

describe('group goal sync payloads', () => {
  it('sets a goal through the RPC with the client-chosen id', async () => {
    const { outcome, rpc } = await run('group_goal.set', set);
    expect(outcome).toMatchObject({ status: 'applied' });
    expect(rpc).toHaveBeenCalledWith('waves_set_group_goal', {
      p_group_id: GROUP_ID,
      p_id: GOAL,
      p_name: 'House',
      p_emoji: '🏠',
      p_target_minor: '1500000',
      p_currency: 'INR',
      p_target_date: '2028-01-01',
      p_for_member_id: null,
      p_monthly_plan: set.monthlyPlan,
    });
  });

  it('archives, adds and voids through their RPCs', async () => {
    expect(
      (await run('group_goal.archive', { goalId: GOAL, status: 'done' })).rpc,
    ).toHaveBeenCalledWith('waves_archive_group_goal', { p_id: GOAL, p_status: 'done' });
    expect((await run('group_goal_contribution.add', add)).rpc).toHaveBeenCalledWith(
      'waves_add_goal_contribution',
      {
        p_goal_id: GOAL,
        p_id: LINE,
        p_member_id: MEMBER_ID,
        p_amount_minor: '-5000',
        p_date: '2026-12-01',
        p_note: null,
      },
    );
    expect(
      (await run('group_goal_contribution.void', { contributionId: LINE })).rpc,
    ).toHaveBeenCalledWith('waves_void_goal_contribution', { p_id: LINE });
  });

  it.each([
    ['group_goal.set', 'no goal id', { ...set, goalId: undefined }],
    ['group_goal.set', 'numeric target', { ...set, targetMinor: 1500000 }],
    ['group_goal.set', 'a list plan', { ...set, monthlyPlan: [1] }],
    ['group_goal.archive', 'no status', { goalId: GOAL }],
    ['group_goal_contribution.add', 'numeric amount', { ...add, amountMinor: -5000 }],
    ['group_goal_contribution.add', 'no date', { ...add, date: undefined }],
    ['group_goal_contribution.void', 'no id', {}],
  ])('refuses %s with %s before the RPC', async (kind, _label, payload) => {
    const { outcome, rpc } = await run(kind, payload);
    expect(outcome).toMatchObject({ status: 'rejected', code: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
