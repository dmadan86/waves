import { describe, expect, it } from 'vitest';

import {
  GoalCurrencyError,
  expectedByToday,
  goalPace,
  goalProgressPct,
  memberMonthStatus,
  monthlyNeeded,
  monthsLeft,
  putAsideTotal,
  type GoalLine,
  type GoalShape,
} from '../src/group/goals';
import { emptyMirror, materialiseGroupGoals } from '../src/sync/mirror';
import type { QueuedMutation } from '../src/sync/queue';
import { MutationKind, SyncTable } from '../src/sync/protocol';

const goal: GoalShape = {
  targetMinor: 1_500_000n,
  currency: 'INR',
  targetDate: '2028-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  monthlyPlan: { a: 200_000n, b: 100_000n },
};
const line = (memberId: string, amountMinor: bigint, date: string): GoalLine => ({
  memberId,
  amountMinor,
  date,
});

describe('goals maths', () => {
  it('totals with withdrawals and never goes below zero', () => {
    expect(
      putAsideTotal(goal, [line('a', 500n, '2026-02-01'), line('b', -200n, '2026-02-02')]),
    ).toBe(300n);
    expect(putAsideTotal(goal, [line('a', -5n, '2026-02-01')])).toBe(0n);
  });

  it('rejects a currency mismatch', () => {
    expect(() =>
      putAsideTotal(goal, [{ ...line('a', 5n, '2026-02-01'), currency: 'USD' }]),
    ).toThrow(GoalCurrencyError);
    expect(() =>
      memberMonthStatus(goal, [{ ...line('a', 5n, '2026-02-01'), currency: 'USD' }], '2026-02'),
    ).toThrow(GoalCurrencyError);
  });

  it('progress is a whole percent, 100 only when reached', () => {
    expect(goalProgressPct(goal, 0n)).toBe(0);
    expect(goalProgressPct(goal, 320_000n)).toBe(21);
    expect(goalProgressPct(goal, 1_499_999n)).toBe(99);
    expect(goalProgressPct(goal, 1_600_000n)).toBe(100);
  });

  it('straight-line pace', () => {
    // 2026-01-01 -> 2028-01-01 is 730 days; 365 days in is exactly half.
    expect(expectedByToday(goal, '2027-01-01')).toBe(750_000n);
    expect(goalPace(goal, 800_000n, '2027-01-01')).toBe('on_track');
    expect(goalPace(goal, 700_000n, '2027-01-01')).toBe('behind');
    expect(expectedByToday(goal, '2025-12-01')).toBe(0n);
    expect(goalPace(goal, 1_500_000n, '2027-01-01')).toBe('done');
  });

  it('no target date: no expectation, no monthly need', () => {
    const open = { ...goal, targetDate: null };
    expect(expectedByToday(open, '2027-01-01')).toBeNull();
    expect(goalPace(open, 1n, '2027-01-01')).toBe('no_date');
    expect(monthsLeft(null, '2027-01-01')).toBeNull();
    expect(monthlyNeeded(open, 0n, '2027-01-01')).toBeNull();
  });

  it('past the date: past due, the whole remainder is needed now', () => {
    expect(goalPace(goal, 100n, '2028-02-01')).toBe('past_due');
    expect(monthsLeft('2028-01-01', '2028-02-01')).toBe(0);
    expect(monthlyNeeded(goal, 500_000n, '2028-02-01')).toBe(1_000_000n);
  });

  it('monthly needed from now, rounded up', () => {
    expect(monthsLeft('2028-01-01', '2027-01-01')).toBe(12);
    expect(monthlyNeeded(goal, 300_000n, '2027-01-01')).toBe(100_000n);
    expect(monthlyNeeded(goal, 300_001n, '2027-01-01')).toBe(100_000n);
    expect(monthlyNeeded(goal, 1_500_000n, '2027-01-01')).toBe(0n);
  });

  it('per-member month: met or short by', () => {
    const lines = [
      line('a', 200_000n, '2026-11-03'),
      line('b', 80_000n, '2026-11-04'),
      line('b', -10_000n, '2026-11-05'),
      line('b', 100_000n, '2026-10-30'),
    ];
    const [a, b] = memberMonthStatus(goal, lines, '2026-11');
    expect(a).toMatchObject({ memberId: 'a', met: true, shortMinor: 0n });
    expect(b).toMatchObject({
      memberId: 'b',
      met: false,
      shortMinor: 30_000n,
      putAsideMinor: 70_000n,
    });
  });
});

describe('materialiseGroupGoals', () => {
  const q = (seq: number, kind: MutationKind, payload: Record<string, unknown>) =>
    ({
      seq,
      kind,
      groupId: 'g1',
      payload,
      clientCreatedAt: `2026-11-0${seq}T00:00:00Z`,
      clientMutationId: `m${seq}`,
    }) as unknown as QueuedMutation;

  it('shows a queued goal, line, and void before the server answers', () => {
    const queue = [
      q(1, MutationKind.GroupGoalSet, {
        goalId: 'x',
        name: ' House ',
        targetMinor: '100',
        currency: 'INR',
      }),
      q(2, MutationKind.GroupGoalContributionAdd, {
        contributionId: 'c1',
        goalId: 'x',
        memberId: 'm',
        amountMinor: '40',
        date: '2026-11-02',
      }),
      q(3, MutationKind.GroupGoalContributionAdd, {
        contributionId: 'c2',
        goalId: 'x',
        memberId: 'm',
        amountMinor: '10',
        date: '2026-11-03',
      }),
      q(4, MutationKind.GroupGoalContributionVoid, { contributionId: 'c2' }),
    ];
    const out = materialiseGroupGoals(emptyMirror(), queue, { groupId: 'g1', myMemberId: 'm' });
    expect(out.goals.map((g) => g.name)).toEqual(['House']);
    expect(out.contributions.map((c) => c.id)).toEqual(['c1']);
  });

  it('keeps the pulled currency on an edit and ignores other groups', () => {
    const mirror = emptyMirror();
    const row = {
      id: 'x',
      group_id: 'g1',
      name: 'A',
      emoji: null,
      target_minor: '5',
      currency: 'INR',
      target_date: null,
      for_member_id: null,
      monthly_plan: {},
      status: 'active',
      created_by: 'm',
      created_at: '2026-10-01T00:00:00Z',
      deleted_at: null,
    };
    const state = { ...mirror, tables: { ...mirror.tables, [SyncTable.GroupGoals]: { x: row } } };
    const out = materialiseGroupGoals(
      state,
      [
        q(1, MutationKind.GroupGoalSet, {
          goalId: 'x',
          name: 'B',
          targetMinor: '9',
          currency: 'USD',
        }),
        {
          ...q(2, MutationKind.GroupGoalArchive, { goalId: 'x', status: 'archived' }),
          groupId: 'other',
        },
      ],
      { groupId: 'g1' },
    );
    expect(out.goals[0]).toMatchObject({ name: 'B', currency: 'INR', status: 'active' });
  });
});
