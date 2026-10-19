import { describe, expect, it } from 'vitest';

import {
  findRecurring,
  nextMonthlyDate,
  normaliseDescription,
  type SavedExpenseFacts,
} from '../src/voice/followUps';
import { Frequency, frequencyOf, scheduleFor } from '../src/personal/frequency';
import { recurringCatchUp, stepOccurrence } from '../src/personal/compute';
import { encodeRecurring, type PersonalRecurring } from '../src/personal/types';

const rule = (over: Partial<PersonalRecurring> = {}): PersonalRecurring => ({
  id: 'rent',
  txnKind: 'expense',
  amount: 1500000n,
  currency: 'INR',
  category: 'home',
  note: 'Rent',
  ...scheduleFor(Frequency.Monthly),
  anchorDate: '2026-01-31',
  nextDate: '2026-01-31',
  endDate: null,
  autoPost: false,
  active: true,
  ...over,
});
const expense: SavedExpenseFacts = {
  scope: 'personal',
  expenseId: 'rent-oct',
  amountMinor: 1500000n,
  currency: 'INR',
  category: 'home',
  categoryStated: true,
  description: 'Rent',
  date: '2026-10-05',
  hasPlace: false,
  hasReceipt: false,
  hasNotes: false,
  hasPaymentMethod: false,
  canAttachReceipt: false,
  canSetPayment: true,
  groupId: null,
  groupName: null,
  members: [],
  splitParticipantCount: 0,
  payerIsMe: true,
};
const past = (date: string, amountMinor = 1500000n) => ({
  description: 'Rent',
  currency: 'INR',
  date,
  amountMinor,
});

describe('recurring dates', () => {
  it.each([
    ['RC-01', '2026-01-31', '2026-02-28'],
    ['RC-02', '2028-01-31', '2028-02-29'],
    ['RC-03', '2028-02-29', '2028-03-29'],
    ['RC-04', '2026-03-31', '2026-04-30'],
    ['RC-05', '2026-12-15', '2027-01-15'],
    ['RC-06', '2026-10-05', '2026-11-05'],
  ])('%s advances %s to %s', (_id, date, expected) => {
    expect(nextMonthlyDate(date)).toBe(expected);
  });

  it('RC-07 remembers the anchor day across six consecutive monthly nextDates', () => {
    const r = rule();
    const dates = [r.nextDate];
    for (let i = 1; i < 6; i++) dates.push(stepOccurrence(r, dates[i - 1]!));
    // BUG?: monthly stepping uses the clamped date rather than restoring anchorDate's 31st.
    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('RC-08 alternates semimonthly days and clamps February in common and leap years', () => {
    const r = rule({ ...scheduleFor(Frequency.TwiceAMonth), anchorDate: '2026-01-01' });
    expect(stepOccurrence(r, '2026-01-01')).toBe('2026-01-15');
    expect(stepOccurrence(r, '2026-01-15')).toBe('2026-02-01');
    expect(stepOccurrence(r, '2026-02-01')).toBe('2026-02-15');
    for (const [year, last] of [
      ['2026', '28'],
      ['2028', '29'],
    ]) {
      const late = rule({
        ...scheduleFor(Frequency.TwiceAMonth, { secondDay: 31 }),
        anchorDate: `${year}-01-01`,
      });
      expect(stepOccurrence(late, `${year}-02-01`)).toBe(`${year}-02-${last}`);
      expect(stepOccurrence(late, `${year}-02-${last}`)).toBe(`${year}-03-01`);
    }
  });

  it('RC-09 fortnightly Sundays cross Europe and US DST boundaries in exactly 14 UTC days', () => {
    const r = rule(scheduleFor(Frequency.Fortnightly));
    for (const [start, expected] of [
      ['2026-03-22', '2026-04-05'],
      ['2026-10-25', '2026-11-08'],
    ] as const) {
      const next = stepOccurrence(r, start);
      expect(next).toBe(expected);
      expect(new Date(`${next}T00:00:00Z`).getUTCDay()).toBe(0);
      expect(Date.parse(`${next}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)).toBe(
        14 * 86400000,
      );
    }
  });

  it('RC-10 quarterly half-yearly and yearly leap-day rules clamp in non-leap February', () => {
    for (const [frequency, interval] of [
      [Frequency.Quarterly, 4],
      [Frequency.HalfYearly, 2],
      [Frequency.Yearly, 1],
    ] as const) {
      const r = rule({ ...scheduleFor(frequency), anchorDate: '2028-02-29' });
      let next = r.anchorDate;
      for (let i = 0; i < interval; i++) next = stepOccurrence(r, next);
      expect(next).toBe('2029-02-28');
    }
  });

  it('RC-11 includes an occurrence on endDate but stops one day before it', () => {
    const r = rule({ anchorDate: '2026-10-05', nextDate: '2026-10-05' });
    expect(recurringCatchUp({ ...r, endDate: '2026-11-05' }, '2026-12-05').dates).toEqual([
      '2026-10-05',
      '2026-11-05',
    ]);
    expect(recurringCatchUp({ ...r, endDate: '2026-11-04' }, '2026-12-05').dates).toEqual([
      '2026-10-05',
    ]);
  });

  it('RC-12 encodes a reminder rule with autoPost false rather than enabling transaction minting', () => {
    expect(encodeRecurring(rule())).toEqual({
      txnKind: 'expense',
      amount: '1500000',
      currency: 'INR',
      category: 'home',
      note: 'Rent',
      cadence: 'monthly',
      interval: 1,
      secondDay: null,
      anchorDate: '2026-01-31',
      nextDate: '2026-01-31',
      endDate: null,
      autoPost: false,
      active: true,
    });
  });

  it('RC-13 returns malformed ISO input unchanged without throwing', () => {
    for (const date of ['', 'not-a-date', '2026-1-05', '21/10/2026']) {
      expect(() => nextMonthlyDate(date)).not.toThrow();
      expect(nextMonthlyDate(date)).toBe(date);
    }
  });

  it('RC-14 guards an out-of-range month instead of rolling through Date.UTC', () => {
    // BUG?: parseDay accepts month 13 and Date.UTC silently rolls it into the next year.
    expect(nextMonthlyDate('2026-13-01')).toBe('2026-13-01');
  });

  it('RC-15 uses the supplied today independently of device timezone', () => {
    // The node global is untyped in core (no @types/node); vitest runs on node.
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
      .process.env;
    const previous = env.TZ;
    try {
      for (const timezone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        env.TZ = timezone;
        expect(nextMonthlyDate('2026-10-21')).toBe('2026-11-21');
        expect(recurringCatchUp(rule({ nextDate: '2026-10-21' }), '2026-10-21').dates).toEqual([
          '2026-10-21',
        ]);
      }
    } finally {
      if (previous === undefined) delete env.TZ;
      else env.TZ = previous;
    }
  });

  it('RC-16 needs two distinct earlier months and ignores current-month entries', () => {
    const august = [past('2026-08-05'), past('2026-08-06')];
    expect(findRecurring(expense, august, [])).toBeNull();
    expect(findRecurring(expense, [...august, past('2026-10-04')], [])).toBeNull();
    expect(findRecurring(expense, [...august, past('2026-09-05')], [])).toEqual({ dayOfMonth: 5 });
  });

  it('RC-17 tolerates an outlier when three earlier months still match', () => {
    expect(
      findRecurring(
        expense,
        [past('2026-06-05', 3000000n), past('2026-07-05'), past('2026-08-05'), past('2026-09-05')],
        [],
      ),
    ).toEqual({ dayOfMonth: 5 });
  });

  it('RC-18 suppresses a rule whose normalised note matches despite case and punctuation', () => {
    const history = [past('2026-08-05'), past('2026-09-05')];
    expect(findRecurring(expense, history, [])).toEqual({ dayOfMonth: 5 });
    // Existing rules are stored as normalised keys by the history builder.
    expect(
      findRecurring({ ...expense, description: 'RENT!!!' }, history, [
        normaliseDescription('Rent --'),
      ]),
    ).toBeNull();
  });

  it.each([
    ['RC-19', Frequency.Weekly],
    ['RC-20', Frequency.Fortnightly],
    ['RC-21', Frequency.TwiceAMonth],
    ['RC-22', Frequency.Monthly],
    ['RC-23', Frequency.Quarterly],
    ['RC-24', Frequency.HalfYearly],
    ['RC-25', Frequency.Yearly],
    ['RC-26', Frequency.EveryNMonths],
  ] as const)('%s round-trips Frequency %s', (_id, frequency) => {
    expect(frequencyOf(scheduleFor(frequency, { interval: 5 }))).toBe(frequency);
  });
});
