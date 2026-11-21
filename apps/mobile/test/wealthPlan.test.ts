import { describe, expect, it } from 'vitest';

import {
  decodeInvestment,
  decodeProperty,
  decodeRecurring,
  decodeTenancy,
  type PersonalTxn,
} from '@waves/core';

import { wealthRows } from '../src/lib/personalUpcoming';

import {
  atInvestmentLimit,
  atPropertyLimit,
  cadenceFor,
  depositTerm,
  monthRent,
  planWealthReminders,
  propertyView,
  raisePrompt,
  rentAnchor,
  rentStrip,
  typeHint,
} from '../src/lib/wealthPlan';

const NOW = new Date(2026, 10, 21, 8, 0).getTime();
const base = { properties: [], txns: [], today: '2026-11-21', now: NOW };

describe('region hints', () => {
  it('words the deposit by region', () => {
    expect(depositTerm('IN')).toBe('depositAdvance');
    expect(depositTerm('AU')).toBe('depositBond');
    expect(depositTerm('US')).toBe('depositSecurity');
    expect(depositTerm('other')).toBe('depositHeld');
  });
  it('names the savings group by region', () => {
    expect(typeHint('savings_group', 'IN')).toBe('Chit fund');
    expect(typeHint('savings_group', 'US')).toBe('Savings circle (ROSCA)');
    expect(typeHint('retirement', 'AU')).toBe('Super');
  });
  it('maps fortnightly to every 2 weeks', () => {
    expect(cadenceFor('fortnightly')).toEqual({ cadence: 'weekly', interval: 2 });
  });
});

describe('free limits', () => {
  it('3 investments and 1 property, unlimited on Pro', () => {
    expect(atInvestmentLimit(3, false)).toBe(true);
    expect(atInvestmentLimit(2, false)).toBe(false);
    expect(atInvestmentLimit(50, true)).toBe(false);
    expect(atPropertyLimit(1, false)).toBe(true);
    expect(atPropertyLimit(1, true)).toBe(false);
  });
});

describe('planWealthReminders', () => {
  const inv = decodeInvestment('i1', { name: 'Fund', type: 'fund' });
  const sip = (autoPost: boolean) =>
    decodeRecurring('r1', {
      txnKind: 'expense',
      amount: '500',
      anchorDate: '2026-12-05',
      nextDate: '2026-12-05',
      cadence: 'monthly',
      investmentId: 'i1',
      autoPost,
    });
  it('reminds the day before an automatic SIP and on the day for a manual one', () => {
    const auto = planWealthReminders({
      ...base,
      investments: [inv],
      tenancies: [],
      recurrings: [sip(true)],
    });
    const manual = planWealthReminders({
      ...base,
      investments: [inv],
      tenancies: [],
      recurrings: [sip(false)],
    });
    expect(new Date(auto[0]!.fireAt).getDate()).toBe(4);
    expect(new Date(manual[0]!.fireAt).getDate()).toBe(5);
    expect(new Date(auto[0]!.fireAt).getHours()).toBe(10);
  });
  it('reminds 60 and 30 days before a lease ends, and 30 and 7 before maturity', () => {
    const tn = decodeTenancy('t1', {
      propertyId: 'p',
      tenantName: 'Ravi',
      status: 'active',
      endDate: '2027-03-01',
    });
    const mat = decodeInvestment('i2', { name: 'FD', type: 'deposit', maturityDate: '2027-01-31' });
    const out = planWealthReminders({
      ...base,
      investments: [mat],
      tenancies: [tn],
      recurrings: [],
    });
    expect(out.map((r) => r.id).sort()).toEqual([
      'lease:t1:30',
      'lease:t1:60',
      'mat:i2:30',
      'mat:i2:7',
    ]);
  });
  it('asks for rent on the due day and again 3 days later until it is recorded', () => {
    const tn = decodeTenancy('t1', { propertyId: 'p', tenantName: 'Ravi', status: 'active' });
    const rent = decodeRecurring('r2', {
      txnKind: 'income',
      amount: '1000',
      anchorDate: '2026-12-01',
      nextDate: '2026-12-01',
      cadence: 'monthly',
      tenancyId: 't1',
      category: 'inc.rent',
    });
    const out = planWealthReminders({
      ...base,
      investments: [],
      tenancies: [tn],
      recurrings: [rent],
    });
    expect(out.map((r) => r.kind)).toEqual(['rentDue', 'rentLate']);
  });
});

describe('rentals', () => {
  const prop = decodeProperty('p1', { type: 'shop', name: 'Shop 2', currency: 'USD' });
  const tn = decodeTenancy('t1', {
    propertyId: 'p1',
    tenantName: 'Ravi',
    status: 'active',
    endDate: '2026-12-15',
  });
  const rent = decodeRecurring('r1', {
    txnKind: 'income',
    amount: '1800',
    currency: 'USD',
    anchorDate: '2026-11-05',
    nextDate: '2026-11-05',
    cadence: 'monthly',
    tenancyId: 't1',
    category: 'inc.rent',
  });
  const pay = (amount: bigint): PersonalTxn => ({
    id: String(amount),
    kind: 'income',
    amount,
    currency: 'USD',
    category: 'inc.rent',
    note: null,
    date: '2026-11-10',
    loanId: null,
    recurringId: 'r1',
  });
  it('starts an existing tenancy this month, not years back', () => {
    expect(rentAnchor('2024-01-01', 5, '2026-11-21', 'monthly')).toBe('2026-11-05');
    expect(rentAnchor('2027-01-01', 5, '2026-11-21', 'monthly')).toBe('2027-01-05');
    expect(rentAnchor('2024-01-01', 5, '2026-11-21', 'fortnightly')).toBe('2026-11-21');
  });
  it('shows a part payment as part paid with the balance still due', () => {
    const v = propertyView(prop, [tn], [rent], [pay(1000n)], '2026-11-21');
    expect(v.status).toBe('part');
    expect(v.balance.balance).toBe(800n);
    expect(monthRent([v], [pay(1000n)], '2026-11')).toEqual({ received: 1000n, expected: 1800n });
    expect(rentStrip(v.balance, '2026-11-21').at(-1)).toEqual({ month: '2026-11', state: 'part' });
  });
  it('lists rent and lease-end rows for Upcoming', () => {
    const rows = wealthRows({
      investments: [],
      properties: [prop],
      tenancies: [tn],
      recurrings: [rent],
      txns: [],
      today: '2026-11-21',
      horizonDays: 30,
      titles: { rent: (n) => `R ${n}`, lease: (n) => `L ${n}`, maturity: (n) => `M ${n}` },
    });
    expect(rows.map((r) => r.key)).toEqual(['rent:t1:2026-11-05', 'lease:t1']);
    expect(rows[0]).toMatchObject({ overdue: true, income: true, amount: 1800n });
  });
});

describe('yearly rent increase prompt', () => {
  const tn = decodeTenancy('t1', {
    propertyId: 'p1',
    tenantName: 'Ravi',
    status: 'active',
    startDate: '2025-12-05',
    escalationPct: 5,
  });
  const rule = (id: string, anchor: string, amount: string) =>
    decodeRecurring(id, {
      txnKind: 'income',
      amount,
      currency: 'USD',
      anchorDate: anchor,
      nextDate: anchor,
      cadence: 'monthly',
      tenancyId: 't1',
      category: 'inc.rent',
    });
  it('asks within 7 days of the anniversary, starting on the rent day', () => {
    const r = rule('r1', '2025-12-05', '180000');
    expect(raisePrompt(tn, [r], '2026-11-27')).toBeNull();
    const p = raisePrompt(tn, [r], '2026-11-28')!;
    expect(p.anniversary).toBe('2026-12-05');
    expect(p.from).toBe('2026-12-05');
    expect(p.newAmount).toBe(189000n);
    expect(p.key).toBe('t1:2026-12-05');
  });
  it('stays quiet once a newer rule starts', () => {
    const rules = [rule('r1', '2025-12-05', '180000'), rule('r2', '2026-12-05', '189000')];
    expect(raisePrompt(tn, rules, '2026-12-20')).toBeNull();
  });
});
