import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { decodeBudget, decodeRecurring, type CurrencyCode } from '@waves/core';

import {
  answersToRecords,
  eatOutMonthly,
  nextDayOfMonth,
  personalSetupAnswers,
  rememberSetup,
  setupSummary,
  type SetupContext,
} from '@/lib/personalSetup';

const ctx: SetupContext = {
  ownerId: 'u1',
  currency: 'INR' as CurrencyCode,
  today: '2026-11-21',
  label: (k) => k,
};
const rupees = (n: number): bigint => BigInt(n) * 100n;

describe('answersToRecords', () => {
  const answers = {
    income: { kind: 'salary', amount: rupees(60000), day: 1 },
    home: { kind: 'rent', amount: rupees(20000), day: 5 },
    bills: [
      { id: 'electricity', amount: rupees(1500), day: 10 },
      { id: 'insurance', amount: rupees(12000), day: 15 },
      { id: 'school', amount: rupees(9000), day: 3 },
    ],
    emi: { kind: 'car', emi: rupees(8000), day: 7, monthsLeft: 12 },
    eatOut: { freq: 'week12', each: rupees(300), monthly: rupees(1900) },
    cap: rupees(15000),
  } as const;

  it('makes expected recurring rules and budgets, never transactions', () => {
    const recs = answersToRecords(structuredClone(answers) as never, ctx);
    expect(recs.map((r) => r.recordKind).sort()).toEqual([
      'budget',
      'budget',
      'recurring',
      'recurring',
      'recurring',
      'recurring',
      'recurring',
      'recurring',
    ]);
    for (const r of recs.filter((x) => x.recordKind === 'recurring')) {
      expect(decodeRecurring(r.recordId, r.data).autoPost).toBe(false);
    }
  });

  it('is idempotent and distinct per slot', () => {
    const a = answersToRecords(answers as never, ctx);
    const b = answersToRecords(answers as never, ctx);
    expect(a.map((r) => r.recordId)).toEqual(b.map((r) => r.recordId));
    expect(new Set(a.map((r) => r.recordId)).size).toBe(a.length);
  });

  it('ends an EMI after the months left and steps quarterly/yearly bills', () => {
    const recs = answersToRecords(answers as never, ctx).map((r) =>
      r.recordKind === 'recurring' ? decodeRecurring(r.recordId, r.data) : null,
    );
    const emi = recs.find((r) => r?.note === 'loan:car')!;
    expect(emi.nextDate).toBe('2026-12-07');
    expect(emi.endDate).toBe('2027-11-07');
    expect(recs.find((r) => r?.note === 'bill:school')!.interval).toBe(3);
    expect(recs.find((r) => r?.note === 'bill:insurance')!.cadence).toBe('yearly');
  });

  it('makes nothing for a "none" answer or a zero amount', () => {
    expect(
      answersToRecords(
        {
          income: { kind: 'none', amount: 0n, day: 1 },
          home: { kind: 'rent', amount: 0n, day: 1 },
        },
        ctx,
      ),
    ).toEqual([]);
  });

  it('writes the food and overall budgets with a null category for overall', () => {
    const budgets = answersToRecords({ eatOut: answers.eatOut, cap: answers.cap }, ctx)
      .filter((r) => r.recordKind === 'budget')
      .map((r) => decodeBudget(r.recordId, r.data));
    expect(budgets.map((b) => b.category).sort()).toEqual(['food', null]);
  });
});

describe('helpers', () => {
  it('picks the next day of the month, clamped', () => {
    expect(nextDayOfMonth('2026-11-21', 25)).toBe('2026-11-25');
    expect(nextDayOfMonth('2026-11-21', 5)).toBe('2026-12-05');
    expect(nextDayOfMonth('2027-01-29', 30)).toBe('2027-01-30');
    expect(nextDayOfMonth('2027-02-10', 31)).toBe('2027-02-28');
  });

  it('computes eat-out as times x 4.3 x amount on the budget grid', () => {
    // 1.5/week x 4.3 x 300 = 1935 -> nearest 100
    expect(eatOutMonthly('week12', rupees(300), 'INR' as CurrencyCode)).toBe(rupees(1900));
    expect(eatOutMonthly('rarely', 0n, 'INR' as CurrencyCode)).toBe(0n);
  });

  it('summarises income, fixed bills, free money and the next bill', () => {
    const recs = answersToRecords(
      {
        income: { kind: 'salary', amount: rupees(60000), day: 1 },
        home: { kind: 'rent', amount: rupees(20000), day: 25 },
        bills: [{ id: 'insurance', amount: rupees(12000), day: 30 }],
      },
      ctx,
    ).map((r) => decodeRecurring(r.recordId, r.data));
    const s = setupSummary(recs, ctx.today, ctx.currency);
    expect(s.comingIn).toBe(rupees(60000));
    expect(s.fixedTotal).toBe(rupees(21000));
    expect(s.fixedCount).toBe(2);
    expect(s.free).toBe(rupees(39000));
    expect(s.perDay).toBe(rupees(1300));
    expect(s.next).toEqual({ name: 'home:rent', days: 4 });
  });
});

describe('setup progress', () => {
  beforeEach(async () => AsyncStorage.clear());

  it('keeps answered steps and the savings band per account', async () => {
    expect((await personalSetupAnswers('u1')).started).toBe(false);
    await rememberSetup('u1', { step: 'income' });
    await rememberSetup('u1', { step: 'savings', savings: '3to6' });
    await rememberSetup('u1', { step: 'income' });
    expect(await personalSetupAnswers('u1')).toEqual({
      done: ['income', 'savings'],
      started: true,
      savings: '3to6',
    });
    expect((await personalSetupAnswers('u2')).done).toEqual([]);
  });
});
