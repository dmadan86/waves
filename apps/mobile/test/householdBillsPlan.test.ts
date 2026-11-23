import type { GroupRecurringRule } from '@waves/core';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  groupBillsForPayer,
  planBillReminders,
  type HeldBillReminder,
  type PayerBill,
} from '@/lib/householdBills';

const rule = (
  id: string,
  nextDate: string,
  payers: Record<string, bigint>,
  status = 'active',
): GroupRecurringRule =>
  ({
    id,
    groupId: 'g1',
    description: id,
    amount: Object.values(payers).reduce((n, v) => n + v, 0n),
    currency: 'INR',
    nextDate,
    status,
    payers,
  }) as unknown as GroupRecurringRule;

describe('groupBillsForPayer', () => {
  it('no member id means no bills', () => {
    expect(groupBillsForPayer([rule('a', '2026-12-01', { m: 5n })], null)).toEqual([]);
  });

  it("lists only bills where the viewer's own share is positive, with that share as the amount", () => {
    const out = groupBillsForPayer(
      [
        rule('mine', '2026-12-02', { m: 700n, o: 300n }),
        rule('theirs', '2026-12-01', { o: 300n }),
        rule('zero', '2026-12-01', { m: 0n, o: 5n }),
        rule('paused', '2026-12-01', { m: 5n }, 'paused'),
      ],
      'm',
    );
    expect(out.map((b) => [b.ruleId, b.amount])).toEqual([['mine', 700n]]);
  });

  it('sorts soonest first and applies the horizon inclusively', () => {
    const rules = [
      rule('c', '2026-12-10', { m: 1n }),
      rule('a', '2026-11-20', { m: 1n }),
      rule('b', '2026-12-05', { m: 1n }),
    ];
    expect(groupBillsForPayer(rules, 'm').map((b) => b.ruleId)).toEqual(['a', 'b', 'c']);
    expect(
      groupBillsForPayer(rules, 'm', { today: '2026-11-30', horizonDays: 5 }).map((b) => b.ruleId),
    ).toEqual(['a', 'b']);
  });

  it('a horizon without today is ignored', () => {
    expect(
      groupBillsForPayer([rule('a', '2030-01-01', { m: 1n })], 'm', { horizonDays: 1 }),
    ).toHaveLength(1);
  });
});

describe('addDays', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('planBillReminders', () => {
  const bill = (ruleId: string, date: string): PayerBill => ({
    ruleId,
    groupId: 'g1',
    description: ruleId,
    amount: 1n,
    currency: 'INR',
    date,
  });
  const now = new Date(2026, 10, 22, 9, 0); // 22 Nov 09:00 local

  it('plans a reminder 3 days ahead and on the day, both at 10:00', () => {
    const { add } = planBillReminders([bill('r', '2026-12-10')], [], now);
    expect(add.map((a) => [a.key, a.kind, a.at.getDate(), a.at.getHours()])).toEqual([
      ['r:2026-12-10:today', 'today', 10, 10],
      ['r:2026-12-10:ahead', 'ahead', 7, 10],
    ]);
  });

  it('never schedules into the past: a bill due today after 10:00 gets nothing, before 10:00 gets today', () => {
    expect(
      planBillReminders([bill('r', '2026-11-22')], [], new Date(2026, 10, 22, 11, 0)).add,
    ).toEqual([]);
    const early = planBillReminders([bill('r', '2026-11-22')], [], now).add;
    expect(early.map((a) => a.kind)).toEqual(['today']);
  });

  it('one reminder per calendar day: the day-of one beats a later bill’s lead reminder', () => {
    const { add } = planBillReminders(
      [bill('late', '2026-12-13'), bill('early', '2026-12-10')],
      [],
      now,
    );
    const onTenth = add.filter((a) => a.at.getDate() === 10);
    expect(onTenth).toHaveLength(1);
    expect(onTenth[0]?.key).toBe('early:2026-12-10:today');
    expect(add.some((a) => a.key === 'late:2026-12-13:ahead')).toBe(false);
  });

  it('is idempotent against what is held, and cancels stale or moved reminders', () => {
    const first = planBillReminders([bill('r', '2026-12-10')], [], now).add;
    const held: HeldBillReminder[] = first.map((a, i) => ({
      identifier: `id${i}`,
      key: a.key,
      fireAt: a.at.getTime(),
    }));
    expect(planBillReminders([bill('r', '2026-12-10')], held, now)).toEqual({
      add: [],
      cancel: [],
    });

    const moved = planBillReminders([bill('r', '2026-12-11')], held, now);
    expect(moved.cancel.sort()).toEqual(['id0', 'id1']);
    expect(moved.add).toHaveLength(2);

    const wrongTime = [{ ...held[0]!, fireAt: held[0]!.fireAt + 1 }];
    const redo = planBillReminders([bill('r', '2026-12-10')], wrongTime, now);
    expect(redo.cancel).toEqual(['id0']);
    expect(redo.add.map((a) => a.key)).toContain(held[0]!.key);
  });

  it('a duplicate held reminder for one key is cancelled, not kept twice', () => {
    const first = planBillReminders([bill('r', '2026-12-10')], [], now).add[0]!;
    const dup: HeldBillReminder[] = [
      { identifier: 'a', key: first.key, fireAt: first.at.getTime() },
      { identifier: 'b', key: first.key, fireAt: first.at.getTime() },
    ];
    expect(planBillReminders([bill('r', '2026-12-10')], dup, now).cancel).toEqual(['b']);
  });
});
