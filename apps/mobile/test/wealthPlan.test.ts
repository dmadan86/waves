import { describe, expect, it } from 'vitest';

import { decodeInvestment, decodeRecurring, decodeTenancy } from '@waves/core';

import {
  atInvestmentLimit,
  atPropertyLimit,
  cadenceFor,
  depositTerm,
  planWealthReminders,
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
