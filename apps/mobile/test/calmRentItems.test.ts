import { describe, expect, it } from 'vitest';
import type {
  PersonalProperty,
  PersonalRecurring,
  PersonalTenancy,
  PersonalTxn,
} from '@waves/core';

import { monthHorizon, rentItems } from '../src/lib/calm/rentDue';

const prop = {
  id: 'p1',
  name: 'Shop2',
  currency: 'INR',
  status: 'active',
  type: 'shop',
} as PersonalProperty;
const tenancy = {
  id: 't1',
  propertyId: 'p1',
  unit: null,
  tenantName: 'Arjun',
  status: 'active',
} as unknown as PersonalTenancy;
const rule = (nextDate: string, anchorDate: string): PersonalRecurring =>
  ({
    id: 'r1',
    tenancyId: 't1',
    txnKind: 'income',
    amount: 1000n,
    currency: 'INR',
    cadence: 'monthly',
    interval: 1,
    secondDay: null,
    anchorDate,
    nextDate,
    endDate: null,
    autoPost: false,
    active: true,
  }) as unknown as PersonalRecurring;
const paid = (date: string): PersonalTxn =>
  ({
    id: `x${date}`,
    kind: 'income',
    amount: 1000n,
    currency: 'INR',
    date,
    recurringId: 'r1',
  }) as PersonalTxn;

const run = (
  recurrings: PersonalRecurring[],
  txns: PersonalTxn[],
  today: string,
  horizonDays: number,
) =>
  rentItems({
    properties: [prop],
    tenancies: [tenancy],
    recurrings,
    txns,
    today,
    horizonDays,
    fallbackCurrency: 'INR',
  });

describe('rentItems', () => {
  it('does not offer a due-today rent that is already paid (nextDate still points at today)', () => {
    const items = run([rule('2026-11-28', '2026-11-28')], [paid('2026-11-28')], '2026-11-28', 0);
    expect(items).toEqual([]);
  });
  it('lists an unpaid due-today rent once, with a fixed-id full payment', () => {
    const items = run([rule('2026-11-28', '2026-11-28')], [], '2026-11-28', 0);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'today', amount: 1000n });
    expect(items[0]!.full).not.toBeNull();
  });
  it('sees a later-this-month rent only with the month-wide horizon', () => {
    const r = [rule('2026-11-20', '2026-10-20')];
    const txns = [paid('2026-10-20')];
    expect(run(r, txns, '2026-11-02', 7)).toEqual([]);
    expect(run(r, txns, '2026-11-02', monthHorizon('2026-11-02'))).toHaveLength(1);
  });
  it('keeps the week horizon as the minimum', () => {
    expect(monthHorizon('2026-11-30')).toBe(7);
    expect(monthHorizon('2026-11-02')).toBe(28);
  });
});
