import { describe, expect, it } from 'vitest';

import {
  BILL_PRESETS,
  billPresetLabelKey,
  billUpcoming,
  billsMonthlyTotal,
  daysFromTo,
  hasHouseholdHome,
  householdSummary,
  mergeHouseholdUpcoming,
  monthlyEquivalent,
  monthlySpend,
  nextDayOfMonth,
  normaliseBillPresetId,
  perDayLeft,
  savablePicks,
  shiftMonthKey,
  type BillPresetId,
} from '../src/group/household';
import { poolExpensePayload, poolSplit } from '../src/group/ledgerMode';

describe('legacy bill preset aliases', () => {
  it.each([
    ['emi', 'home_loan'],
    ['maid', 'household_help'],
    ['cook', 'household_help'],
    ['driver', 'household_help'],
    ['sip', 'investment_contribution'],
    ['ott', 'streaming'],
    ['petrol', 'fuel'],
    ['wifi', 'internet'],
    ['maintenance', 'building_fees'],
    ['school', 'childcare_school'],
  ])('%s reads as %s', (old, neutral) => {
    expect(normaliseBillPresetId(old)).toBe(neutral);
  });

  it('every current preset id maps to itself and every alias lands on a real preset', () => {
    for (const p of BILL_PRESETS) expect(normaliseBillPresetId(p.id)).toBe(p.id);
    const ids = new Set<string>(BILL_PRESETS.map((p) => p.id));
    for (const old of [
      'emi',
      'maid',
      'cook',
      'driver',
      'sip',
      'ott',
      'petrol',
      'wifi',
      'maintenance',
      'school',
    ])
      expect(ids.has(normaliseBillPresetId(old)!)).toBe(true);
  });

  it('unknown and empty values are null', () => {
    for (const bad of ['', 'nope', 'RENT']) expect(normaliseBillPresetId(bad)).toBeNull();
  });

  it('inherited-object keys are null', () => {
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(normaliseBillPresetId(bad)).toBeNull();
  });
});

describe('region labels', () => {
  const key = (p: BillPresetId, c: string | null | undefined) => billPresetLabelKey(p, c);
  it('India', () => {
    expect(key('home_loan', 'IN')).toBe('emi');
    expect(key('household_help', 'IN')).toBe('maid_cook_driver');
    expect(key('streaming', 'IN')).toBe('ott');
    expect(key('fuel', 'IN')).toBe('petrol');
    expect(key('building_fees', 'IN')).toBe('society_maintenance');
  });
  it('US, UK (GB and UK), Australia, UAE', () => {
    expect(key('building_fees', 'US')).toBe('hoa');
    expect(key('fuel', 'US')).toBe('fuel_gas');
    expect(key('building_fees', 'GB')).toBe('service_charge');
    expect(key('building_fees', 'UK')).toBe('service_charge');
    expect(key('childcare_school', 'GB')).toBe('council_tax');
    expect(key('building_fees', 'AU')).toBe('strata');
    expect(key('childcare_school', 'AU')).toBe('rates');
    expect(key('electricity', 'AE')).toBe('dewa');
    expect(key('water', 'AE')).toBe('chiller');
  });
  it('is case-insensitive and neutral for unknown, null and undefined regions', () => {
    expect(key('building_fees', 'in')).toBe('society_maintenance');
    for (const c of [null, undefined, '', 'ZZ'])
      expect(key('building_fees', c)).toBe('building_fees');
  });
  it('presets without a regional term stay neutral everywhere', () => {
    for (const c of ['IN', 'US', 'GB', 'AU', 'AE']) expect(key('rent', c)).toBe('rent');
  });
});

describe('monthlyEquivalent', () => {
  const eq = (
    amount: bigint,
    cadence: 'weekly' | 'semimonthly' | 'monthly' | 'yearly',
    interval = 1,
  ) => monthlyEquivalent({ amount, cadence, interval });

  it('monthly is itself; every 3 months (quarterly) is a third, rounded half up', () => {
    expect(eq(120000n, 'monthly')).toBe(120000n);
    expect(eq(300000n, 'monthly', 3)).toBe(100000n);
    expect(eq(100n, 'monthly', 3)).toBe(33n);
    expect(eq(200n, 'monthly', 3)).toBe(67n);
  });
  it('weekly is 52/12 a month; fortnightly (every 2 weeks) half of that', () => {
    expect(eq(1200n, 'weekly')).toBe(5200n);
    expect(eq(1200n, 'weekly', 2)).toBe(2600n);
  });
  it('semimonthly is twice a month', () => {
    expect(eq(5000n, 'semimonthly')).toBe(10000n);
  });
  it('yearly is a twelfth; every 2 years a twenty-fourth', () => {
    expect(eq(120000n, 'yearly')).toBe(10000n);
    expect(eq(240000n, 'yearly', 2)).toBe(10000n);
  });
  it('treats a zero or negative interval as 1 and never divides by zero', () => {
    expect(eq(500n, 'monthly', 0)).toBe(500n);
    expect(eq(500n, 'weekly', -4)).toBe(eq(500n, 'weekly', 1));
  });
  it('zero stays zero', () => {
    for (const c of ['weekly', 'semimonthly', 'monthly', 'yearly'] as const)
      expect(eq(0n, c)).toBe(0n);
  });
  it('totals skip other currencies and non-active bills', () => {
    const r = (amount: bigint, currency: string, status: string) => ({
      amount,
      cadence: 'monthly' as const,
      interval: 1,
      currency,
      status,
    });
    expect(
      billsMonthlyTotal(
        [r(100n, 'INR', 'active'), r(50n, 'USD', 'active'), r(70n, 'INR', 'paused')],
        'INR',
      ),
    ).toBe(100n);
    expect(billsMonthlyTotal([], 'INR')).toBe(0n);
  });
});

describe('hasHouseholdHome', () => {
  it('null, undefined and untyped groups have no household home', () => {
    expect(hasHouseholdHome(null)).toBe(false);
    expect(hasHouseholdHome(undefined)).toBe(false);
    expect(hasHouseholdHome({})).toBe(false);
    expect(hasHouseholdHome({ type: 'trip' })).toBe(false);
  });
  it('a pooled group of any type has one', () => {
    expect(hasHouseholdHome({ type: 'trip', ledger_mode: 'pool' })).toBe(true);
    expect(hasHouseholdHome({ type: 'couple', ledger_mode: 'split' })).toBe(true);
  });
});

describe('pool split', () => {
  it('shares sum to what was paid, so nobody owes', () => {
    const payers = { a: 700n, b: 300n, c: 0n };
    const { splitParams, participants } = poolSplit(payers);
    expect(participants.sort()).toEqual(['a', 'b']);
    const amounts = (splitParams as { amounts: Record<string, bigint> }).amounts;
    expect(Object.values(amounts).reduce((n, v) => n + v, 0n)).toBe(1000n);
    expect(amounts).toEqual({ a: 700n, b: 300n });
  });
  it('no payers gives an empty exact split', () => {
    expect(poolSplit({})).toEqual({
      splitParams: { kind: 'exact', amounts: {} },
      participants: [],
    });
  });
  it('wire payload: an all-zero payer map and a missing split are left alone', () => {
    const zero = { splitParams: { kind: 'equal' }, payers: { a: '0' } };
    expect(poolExpensePayload(zero)).toBe(zero);
    const noSplit = { payers: { a: '5' } };
    expect(poolExpensePayload(noSplit)).toBe(noSplit);
  });
  it('wire payload: equal becomes exact on the payers, dropping expectedShares', () => {
    const out = poolExpensePayload({
      splitParams: { kind: 'equal' },
      payers: { a: '600', b: '400', c: '0' },
      expectedShares: { a: '500' },
    });
    expect(out).toEqual({
      splitParams: { kind: 'exact', amounts: { a: '600', b: '400' } },
      participants: ['a', 'b'],
      payers: { a: '600', b: '400', c: '0' },
    });
  });
});

describe('savablePicks edges', () => {
  const pick = (preset: BillPresetId, amount: bigint, payerId: string) => ({
    preset,
    amount,
    payerId,
  });
  it('drops zero amounts, requires a payer for bills only, routes estimates to budgets', () => {
    const { bills, budgets } = savablePicks([
      pick('rent', 100n, 'a'),
      pick('rent', 0n, 'a'),
      pick('electricity', 50n, ''),
      pick('groceries', 80n, ''),
      pick('fuel', 0n, ''),
    ]);
    expect(bills.map((b) => b.preset)).toEqual(['rent']);
    expect(budgets.map((b) => b.preset)).toEqual(['groceries']);
  });
});

describe('dates and months', () => {
  it('nextDayOfMonth: today counts, rolls over December, clamps to 1-28, truncates', () => {
    expect(nextDayOfMonth('2026-11-10', 10)).toBe('2026-11-10');
    expect(nextDayOfMonth('2026-11-11', 10)).toBe('2026-12-10');
    expect(nextDayOfMonth('2026-12-20', 5)).toBe('2027-01-05');
    expect(nextDayOfMonth('2026-02-01', 31)).toBe('2026-02-28');
    expect(nextDayOfMonth('2026-02-01', 0)).toBe('2026-02-01');
    expect(nextDayOfMonth('2026-02-01', 3.9)).toBe('2026-02-03');
  });

  it('shiftMonthKey crosses year boundaries both ways', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-06', -18)).toBe('2024-12');
    expect(shiftMonthKey('2026-06', 0)).toBe('2026-06');
  });

  it('monthlySpend keeps the window across a year end and ignores other currencies and old months', () => {
    const out = monthlySpend(
      [
        { date: '2026-12-31', amount: 10n, currency: 'INR' },
        { date: '2026-12-01', amount: 5n, currency: 'INR' },
        { date: '2026-12-15', amount: 99n, currency: 'USD' },
        { date: '2026-01-01', amount: 77n, currency: 'INR' },
        { date: '2027-01-02', amount: 3n, currency: 'INR' },
      ],
      'INR',
      '2027-01-10',
      3,
    );
    expect(out).toEqual([
      { month: '2026-11', total: 0n },
      { month: '2026-12', total: 15n },
      { month: '2027-01', total: 3n },
    ]);
  });

  it('perDayLeft: includes today, handles leap February, and is 0 when nothing is left', () => {
    expect(perDayLeft(3100n, '2026-12-01')).toBe(100n);
    expect(perDayLeft(100n, '2026-12-31')).toBe(100n);
    expect(perDayLeft(2900n, '2028-02-01')).toBe(100n);
    expect(perDayLeft(0n, '2026-12-01')).toBe(0n);
    expect(perDayLeft(-5n, '2026-12-01')).toBe(0n);
  });

  it('householdSummary: no change % when last month was empty; negative left when over', () => {
    expect(householdSummary({ spent: 500n, lastMonthSpent: 0n, income: 400n })).toEqual({
      spent: 500n,
      income: 400n,
      left: -100n,
      changePct: null,
    });
    expect(householdSummary({ spent: 150n, lastMonthSpent: 100n, income: 0n }).changePct).toBe(50);
    expect(householdSummary({ spent: 50n, lastMonthSpent: 100n, income: 0n }).changePct).toBe(-50);
  });

  it('daysFromTo across a DST-style month boundary is whole days', () => {
    expect(daysFromTo('2026-03-28', '2026-04-02')).toBe(5);
    expect(daysFromTo('2026-12-31', '2026-01-01')).toBe(-364);
  });
});

describe('billUpcoming and merge', () => {
  const rule = (
    id: string,
    nextDate: string,
    status = 'active',
    payers: Record<string, bigint> = {},
  ) => ({
    id,
    description: id,
    amount: 100n,
    currency: 'INR',
    nextDate,
    status,
    payers,
  });
  it('includes overdue and the horizon day, excludes beyond and non-active', () => {
    const out = billUpcoming(
      [
        rule('late', '2026-11-01'),
        rule('edge', '2026-11-30'),
        rule('far', '2026-12-01'),
        rule('off', '2026-11-22', 'paused'),
      ],
      '2026-11-22',
      8,
    );
    expect(out.map((u) => [u.ruleId, u.inDays])).toEqual([
      ['late', -21],
      ['edge', 8],
    ]);
  });
  it('the payer is whoever paid most; none when nobody paid', () => {
    const [a] = billUpcoming(
      [rule('x', '2026-11-22', 'active', { m1: 30n, m2: 70n })],
      '2026-11-22',
      0,
    );
    expect(a?.payerId).toBe('m2');
    const [b] = billUpcoming([rule('y', '2026-11-22')], '2026-11-22', 0);
    expect(b?.payerId).toBeNull();
  });
  it('the key is the rule id and occurrence date, matching what the server seeds from', () => {
    const [u] = billUpcoming([rule('r1', '2026-11-25')], '2026-11-22', 7);
    expect(u?.key).toBe('bill:r1:2026-11-25');
  });
  it('merge orders by date then title, caps at limit, 0 keeps all', () => {
    const merged = mergeHouseholdUpcoming(
      [
        billUpcoming(
          [rule('b', '2026-11-25'), rule('a', '2026-11-25'), rule('c', '2026-11-23')],
          '2026-11-22',
          7,
        ),
        billUpcoming([rule('z', '2026-11-22')], '2026-11-22', 0),
      ],
      0,
    );
    expect(merged.map((m) => m.title)).toEqual(['z', 'c', 'a', 'b']);
    expect(mergeHouseholdUpcoming([merged], 2).map((m) => m.title)).toEqual(['z', 'c']);
  });
});
