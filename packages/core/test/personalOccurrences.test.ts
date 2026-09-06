/**
 * Whether a scheduled payment actually arrived (A48).
 *
 * The rule this file exists to protect: **an occurrence is claimed by an entry
 * falling inside its window, not by an entry matching its date.** Rent due on
 * the 5th and paid on the 7th is that month's rent. Get that wrong and the app
 * tells somebody their tenant did not pay, and then offers to record the
 * payment a second time.
 */

import { describe, expect, it } from 'vitest';

import {
  dueInMonth,
  Frequency,
  FREQUENCIES,
  frequencyOf,
  scheduleFor,
  monthOutlook,
  monthRange,
  occurrences,
  stepOccurrence,
  unpostedOccurrences,
  recurringOccurrenceId,
  type PersonalRecurring,
  type PersonalTxn,
} from '../src/personal/index.js';

const RULE_ID = 'rule-rent';

const rule = (over: Partial<PersonalRecurring> = {}): PersonalRecurring => ({
  id: over.id ?? RULE_ID,
  txnKind: over.txnKind ?? 'income',
  amount: over.amount ?? 2_500_000n,
  currency: over.currency ?? 'INR',
  category: over.category ?? 'inc.rent',
  note: over.note ?? 'Flat rent',
  cadence: over.cadence ?? 'monthly',
  interval: over.interval ?? 1,
  secondDay: over.secondDay ?? null,
  anchorDate: over.anchorDate ?? '2026-01-05',
  nextDate: over.nextDate ?? '2026-01-05',
  endDate: over.endDate ?? null,
  autoPost: over.autoPost ?? false,
  active: over.active ?? true,
});

const paid = (date: string, amount = 2_500_000n, id = `t-${date}`): PersonalTxn => ({
  id,
  kind: 'income',
  amount,
  currency: 'INR',
  category: 'inc.rent',
  note: null,
  date,
  loanId: null,
  recurringId: RULE_ID,
});

const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const statuses = (list: readonly { status: string }[]): string[] => list.map((o) => o.status);

describe('stepOccurrence', () => {
  it('walks the ordinary cadences exactly as addToDate does', () => {
    expect(stepOccurrence(rule({ cadence: 'monthly' }), '2026-01-05')).toBe('2026-02-05');
    expect(stepOccurrence(rule({ cadence: 'monthly', interval: 3 }), '2026-01-05')).toBe(
      '2026-04-05',
    );
    expect(stepOccurrence(rule({ cadence: 'monthly', interval: 6 }), '2026-01-05')).toBe(
      '2026-07-05',
    );
    expect(stepOccurrence(rule({ cadence: 'weekly' }), '2026-01-05')).toBe('2026-01-12');
    expect(stepOccurrence(rule({ cadence: 'weekly', interval: 2 }), '2026-01-05')).toBe(
      '2026-01-19',
    );
    expect(stepOccurrence(rule({ cadence: 'yearly' }), '2026-01-05')).toBe('2027-01-05');
  });

  it('alternates between a twice-a-month rule two days', () => {
    const twice = rule({ cadence: 'semimonthly', anchorDate: '2026-01-01', secondDay: 16 });
    expect(stepOccurrence(twice, '2026-01-01')).toBe('2026-01-16');
    expect(stepOccurrence(twice, '2026-01-16')).toBe('2026-02-01');
    expect(stepOccurrence(twice, '2026-02-01')).toBe('2026-02-16');
  });

  it('rolls a twice-a-month rule across a year boundary', () => {
    const twice = rule({ cadence: 'semimonthly', anchorDate: '2026-12-01', secondDay: 16 });
    expect(stepOccurrence(twice, '2026-12-16')).toBe('2027-01-01');
  });

  it('clamps a late second day into a short month', () => {
    // Paid on the 15th and the 31st: February has neither, so the month's
    // second pay day is the 28th — what a payroll actually does.
    const twice = rule({ cadence: 'semimonthly', anchorDate: '2026-01-15', secondDay: 31 });
    expect(stepOccurrence(twice, '2026-01-15')).toBe('2026-01-31');
    expect(stepOccurrence(twice, '2026-01-31')).toBe('2026-02-15');
    expect(stepOccurrence(twice, '2026-02-15')).toBe('2026-02-28');
    expect(stepOccurrence(twice, '2026-02-28')).toBe('2026-03-15');
  });

  it('takes the two days in calendar order however they were given', () => {
    // Anchored on the later of the pair: the walk must still go 16th then 28th.
    const twice = rule({ cadence: 'semimonthly', anchorDate: '2026-01-28', secondDay: 16 });
    expect(stepOccurrence(twice, '2026-01-28')).toBe('2026-02-16');
    expect(stepOccurrence(twice, '2026-02-16')).toBe('2026-02-28');
  });
});

describe('occurrences', () => {
  it('walks from the anchor, not from nextDate, so old months are visible', () => {
    // The whole point of back-filling: a rule written today with a start date a
    // year ago must show that year, even though `nextDate` has never moved.
    const list = occurrences(rule({ nextDate: '2026-09-05' }), [], YEAR, '2026-09-10');
    expect(list).toHaveLength(12);
    expect(list[0]?.dueDate).toBe('2026-01-05');
    expect(list[11]?.dueDate).toBe('2026-12-05');
  });

  it('counts a late payment as that month, not a miss', () => {
    // Due the 5th, paid the 7th. The regression this file exists for.
    const list = occurrences(rule(), [paid('2026-01-07')], YEAR, '2026-03-10');
    expect(list[0]).toMatchObject({ status: 'received', actual: 2_500_000n });
  });

  it('settles the window a payment falls in, not the month it is dated', () => {
    // Paid on 3 February, before February's own due date on the 5th: that falls
    // inside January's window, so it settles January — right, because it is
    // money that arrived during the stretch January was waiting through.
    const list = occurrences(rule(), [paid('2026-02-03')], YEAR, '2026-03-10');
    expect(statuses(list.slice(0, 3))).toEqual(['received', 'missed', 'due']);
  });

  it('keeps the amount that actually arrived when it differs', () => {
    const short = occurrences(rule(), [paid('2026-01-05', 2_000_000n)], YEAR, '2026-02-10');
    expect(short[0]).toMatchObject({
      status: 'received',
      expected: 2_500_000n,
      actual: 2_000_000n,
    });
  });

  it('spends each payment on one occurrence only', () => {
    // Two payments inside January's window must not settle February as well.
    const twice = [paid('2026-01-05', 2_500_000n, 'a'), paid('2026-01-20', 2_500_000n, 'b')];
    const list = occurrences(rule(), twice, YEAR, '2026-03-10');
    expect(statuses(list.slice(0, 2))).toEqual(['received', 'missed']);
  });

  it('separates the month still running from the months gone by', () => {
    // On 10 March: January and February are past and unpaid — missed. March's
    // 5th has come but March is not over, so it is due, not an accusation.
    const list = occurrences(rule(), [], YEAR, '2026-03-10');
    expect(statuses(list.slice(0, 5))).toEqual(['missed', 'missed', 'due', 'future', 'future']);
  });

  it('calls the due date itself due, never missed', () => {
    const list = occurrences(rule(), [], YEAR, '2026-03-05');
    expect(list[2]).toMatchObject({ dueDate: '2026-03-05', status: 'due' });
  });

  it('stops at the end date', () => {
    const list = occurrences(rule({ endDate: '2026-04-30' }), [], YEAR, '2026-12-31');
    expect(list).toHaveLength(4);
    expect(list[3]?.dueDate).toBe('2026-04-05');
  });

  it('ignores entries belonging to another rule', () => {
    const other = { ...paid('2026-01-05'), recurringId: 'someone-else' };
    expect(occurrences(rule(), [other], YEAR, '2026-02-10')[0]?.status).toBe('missed');
  });

  it('returns nothing for a rule with no start date', () => {
    expect(occurrences(rule({ anchorDate: '' }), [], YEAR, '2026-06-01')).toEqual([]);
  });

  it('keys a month, a half-month and a week distinguishably', () => {
    expect(occurrences(rule(), [], YEAR, '2026-06-01')[0]?.periodKey).toBe('2026-01');

    const twice = rule({ cadence: 'semimonthly', anchorDate: '2026-01-01', secondDay: 16 });
    const halves = occurrences(twice, [], { from: '2026-01-01', to: '2026-01-31' }, '2026-06-01');
    expect(halves.map((o) => o.periodKey)).toEqual(['2026-01.1', '2026-01.2']);

    const weekly = rule({ cadence: 'weekly', anchorDate: '2026-01-05' });
    expect(occurrences(weekly, [], YEAR, '2026-06-01')[0]?.periodKey).toBe('2026-01-05');
  });
});

describe('monthOutlook', () => {
  const salary = rule({ id: 'r-sal', category: 'inc.salary', amount: 8_000_000n });
  const emi = rule({ id: 'r-emi', txnKind: 'expense', amount: 1_500_000n, category: 'home' });

  it('keeps what arrived and what is still expected apart', () => {
    const txns = [{ ...paid('2026-03-05', 8_000_000n, 'sal'), recurringId: 'r-sal' }];
    const out = monthOutlook(txns, [salary, emi], '2026-03', 'INR', '2026-03-10');
    expect(out).toMatchObject({
      income: 8_000_000n,
      expense: 0n,
      expectedIncome: 0n,
      expectedExpense: 1_500_000n,
    });
  });

  it('never folds expected money into the total that arrived', () => {
    const out = monthOutlook([], [salary], '2026-03', 'INR', '2026-03-10');
    expect(out.income).toBe(0n);
    expect(out.net).toBe(0n);
    expect(out.expectedIncome).toBe(8_000_000n);
  });

  it('ignores a paused rule and another currency', () => {
    const paused = rule({ id: 'r-off', active: false });
    const foreign = rule({ id: 'r-usd', currency: 'USD' });
    const out = monthOutlook([], [paused, foreign], '2026-03', 'INR', '2026-03-10');
    expect(out.expectedIncome).toBe(0n);
  });
});

describe('dueInMonth', () => {
  it('lists what has not arrived, oldest first, including what was missed', () => {
    const rent = rule({ id: 'r-rent', anchorDate: '2026-03-05' });
    const salary = rule({ id: 'r-sal', anchorDate: '2026-03-01', amount: 8_000_000n });
    const list = dueInMonth([], [rent, salary], '2026-03', 'INR', '2026-03-20');
    expect(list.map((d) => d.rule.id)).toEqual(['r-sal', 'r-rent']);
  });

  it('drops an occurrence once it has been recorded', () => {
    const rent = rule({ id: RULE_ID, anchorDate: '2026-03-05' });
    expect(dueInMonth([paid('2026-03-06')], [rent], '2026-03', 'INR', '2026-03-20')).toEqual([]);
  });

  it('says nothing about a month that has not started', () => {
    const rent = rule({ anchorDate: '2026-03-05' });
    expect(dueInMonth([], [rent], '2026-05', 'INR', '2026-03-20')).toEqual([]);
  });
});

describe('monthRange', () => {
  it('gives the first and last day, leap years included', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('refuses anything that is not a month', () => {
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('nonsense')).toBeNull();
  });
});

describe('frequency presets', () => {
  it('stores every pattern people name', () => {
    expect(scheduleFor(Frequency.Monthly)).toMatchObject({ cadence: 'monthly', interval: 1 });
    expect(scheduleFor(Frequency.Quarterly)).toMatchObject({ cadence: 'monthly', interval: 3 });
    expect(scheduleFor(Frequency.HalfYearly)).toMatchObject({ cadence: 'monthly', interval: 6 });
    expect(scheduleFor(Frequency.Fortnightly)).toMatchObject({ cadence: 'weekly', interval: 2 });
    expect(scheduleFor(Frequency.Yearly)).toMatchObject({ cadence: 'yearly', interval: 1 });
    expect(scheduleFor(Frequency.EveryNMonths, { interval: 5 })).toMatchObject({
      cadence: 'monthly',
      interval: 5,
    });
  });

  it('gives a twice-a-month rule a second day even when none was chosen', () => {
    // Without one it would fire once a month while claiming to fire twice.
    expect(scheduleFor(Frequency.TwiceAMonth)).toMatchObject({
      cadence: 'semimonthly',
      secondDay: 15,
    });
    expect(scheduleFor(Frequency.TwiceAMonth, { secondDay: 20 }).secondDay).toBe(20);
  });

  it('reads a stored rule back as the pattern it was made with', () => {
    expect(frequencyOf({ cadence: 'monthly', interval: 1 })).toBe(Frequency.Monthly);
    expect(frequencyOf({ cadence: 'monthly', interval: 3 })).toBe(Frequency.Quarterly);
    expect(frequencyOf({ cadence: 'monthly', interval: 6 })).toBe(Frequency.HalfYearly);
    expect(frequencyOf({ cadence: 'weekly', interval: 2 })).toBe(Frequency.Fortnightly);
    expect(frequencyOf({ cadence: 'semimonthly', interval: 1 })).toBe(Frequency.TwiceAMonth);
  });

  it('does not pass an unnamed interval off as monthly', () => {
    // Every five months has no name; opening it in the editor must not turn it
    // into a monthly rule on the next save.
    expect(frequencyOf({ cadence: 'monthly', interval: 5 })).toBe(Frequency.EveryNMonths);
  });

  it('round-trips every named pattern', () => {
    for (const frequency of FREQUENCIES) {
      const schedule = scheduleFor(frequency, { interval: 5 });
      expect(frequencyOf(schedule)).toBe(frequency);
    }
  });
});

describe('unpostedOccurrences', () => {
  const auto = rule({ anchorDate: '2026-01-05', nextDate: '2026-01-05', autoPost: true });

  it('owes every period nothing has recorded', () => {
    expect(unpostedOccurrences(auto, [], '2026-03-20').dates).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
    ]);
  });

  it('leaves a hand-recorded period alone even when its date differs', () => {
    // Due the 5th, recorded as arriving on the 7th for less than expected. The
    // row already exists under the occurrence's own id, so re-posting would not
    // duplicate it — it would overwrite what the person entered.
    const recorded = {
      ...paid('2026-01-07', 2_400_000n),
      id: recurringOccurrenceId(RULE_ID, '2026-01-05'),
    };
    expect(unpostedOccurrences(auto, [recorded], '2026-03-20').dates).toEqual([
      '2026-02-05',
      '2026-03-05',
    ]);
  });

  it('still reports where the schedule moves to', () => {
    expect(unpostedOccurrences(auto, [], '2026-03-20').nextDate).toBe('2026-04-05');
  });
});
