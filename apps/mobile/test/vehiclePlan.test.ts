import { describe, expect, it } from 'vitest';

import { decodeTxn, encodeTxn, type PersonalLicence, type PersonalVehicle } from '@waves/core';

import { liveDocPropertyIds } from '@/lib/rentalScope';
import { slotsOf } from '@/lib/propertyDocsPure';
import {
  atVehicleLimit,
  daysUntil,
  distanceUnit,
  dueSoon,
  fuelVolumeUnit,
  licenceDue,
  monthSpend,
  ownActiveVehicles,
  planVehicleReminders,
  renewalHint,
  spendStrip,
} from '@/lib/vehiclePlan';

const veh = (renewals: PersonalVehicle['renewals'], extra: Partial<PersonalVehicle> = {}): PersonalVehicle => ({
  id: 'v1',
  type: 'car',
  name: 'Swift',
  registration: null,
  makeModel: null,
  year: null,
  fuel: 'petrol',
  currency: 'INR',
  status: 'active',
  odometer: null,
  notes: null,
  customFields: [],
  renewals,
  ...extra,
});
const ren = (id: string, dueDate: string, remindDaysBefore = 15) => ({
  id,
  kind: 'insurance' as const,
  label: null,
  dueDate,
  remindDaysBefore,
  policyNumber: null,
  provider: null,
});
const txn = (id: string, date: string, amount: bigint, vehicleId: string | null, currency = 'INR') =>
  decodeTxn(
    id,
    encodeTxn({
      kind: 'expense',
      amount,
      currency,
      category: 'travel',
      note: null,
      date,
      loanId: null,
      recurringId: null,
      ...(vehicleId ? { vehicleId, vehicleKind: 'fuel' as const } : {}),
    }),
  );

describe('free cap', () => {
  it('one vehicle free, Pro unlimited', () => {
    expect(atVehicleLimit(0, false)).toBe(false);
    expect(atVehicleLimit(1, false)).toBe(true);
    expect(atVehicleLimit(5, true)).toBe(false);
  });
  it('counts only my active vehicles', () => {
    const rec = (id: string, status: string, by?: string) => ({ id, record_kind: 'vehicle', data: { status }, created_by: by });
    expect(ownActiveVehicles([rec('a', 'active', 'me'), rec('b', 'active', 'other'), rec('c', 'sold', 'me'), rec('d', 'active')], 'me')).toBe(2);
  });
});

describe('due soon', () => {
  const today = '2026-11-27';
  it('inside the window only', () => {
    const v = veh([ren('a', '2026-12-09'), ren('b', '2027-03-01'), ren('c', '2026-12-12')]);
    expect(dueSoon(v, today).map((d) => d.key)).toEqual(['v1:a', 'v1:c']);
    expect(dueSoon(v, today)[0]!.inDays).toBe(12);
  });
  it('keeps recent overdue, drops stale', () => {
    expect(dueSoon(veh([ren('a', '2026-11-20')]), today)[0]!.inDays).toBe(-7);
    expect(dueSoon(veh([ren('a', '2026-01-01')]), today)).toHaveLength(0);
  });
  it('handles month and year ends', () => {
    expect(daysUntil('2026-12-31', '2027-01-01')).toBe(1);
  });
  it('licence expiry', () => {
    const l: PersonalLicence = { id: 'l', holderName: 'A', number: null, licenceClass: null, expiry: '2026-12-01', remindDaysBefore: 15, vehicleIds: [] };
    expect(licenceDue(l, today)?.inDays).toBe(4);
    expect(licenceDue({ ...l, expiry: null }, today)).toBeNull();
  });
});

describe('reminders', () => {
  it('fires remindDaysBefore ahead at 10:00, once, only in the future', () => {
    const now = new Date(2026, 10, 27, 12).getTime();
    const out = planVehicleReminders({
      vehicles: [veh([ren('a', '2027-03-01', 15), ren('b', '2026-12-05', 15)])],
      licences: [],
      now,
    });
    expect(out).toHaveLength(1);
    expect(new Date(out[0]!.fireAt)).toEqual(new Date(2027, 1, 14, 10));
    expect(out[0]!.url).toBe('waves://vehicles/v1');
  });
  it('skips sold vehicles', () => {
    expect(planVehicleReminders({ vehicles: [veh([ren('a', '2030-01-01')], { status: 'sold' })], licences: [], now: 0 })).toHaveLength(0);
  });
});

describe('regions', () => {
  it('labels are hints by country', () => {
    expect(renewalHint('emission_test', 'IN')).toBe('Pollution (PUC)');
    expect(renewalHint('emission_test', 'US')).toBeNull();
    expect(renewalHint('inspection', 'GB')).toBe('MOT');
    expect(renewalHint('inspection', 'US')).toBe('Inspection');
    expect(renewalHint('registration', 'AE')).toBe('Registration renewal');
    expect(renewalHint('registration', 'AU')).toBe('Rego');
    expect(renewalHint('inspection', 'AU')).toBe('Roadworthy');
    expect(renewalHint('insurance', 'IN')).toBeNull();
  });
  it('units', () => {
    expect(distanceUnit('GB')).toBe('mi');
    expect(distanceUnit('US')).toBe('mi');
    expect(distanceUnit('IN')).toBe('km');
    expect(fuelVolumeUnit('US')).toBe('gal');
    expect(fuelVolumeUnit('GB')).toBe('L');
  });
});

describe('spend', () => {
  const txns = [
    txn('1', '2026-11-03', 500_000_000_000_000_000n, 'v1'),
    txn('2', '2026-11-10', 1_00n, 'v1'),
    txn('3', '2026-11-11', 9_00n, 'v2'),
    txn('4', '2026-10-30', 5_00n, 'v1'),
    txn('5', '2026-11-12', 7_00n, null),
    txn('6', '2026-11-12', 3_00n, 'v1', 'USD'),
  ];
  it('per vehicle and all vehicles, bigint safe, own currency', () => {
    expect(monthSpend(txns, 'v1', '2026-11', 'INR')).toBe(500_000_000_000_000_100n);
    expect(monthSpend(txns, null, '2026-11', 'INR')).toBe(500_000_000_000_001_000n);
  });
  it('12 month strip ends this month', () => {
    const s = spendStrip(txns, 'v1', '2026-11-27', 'INR');
    expect(s).toHaveLength(12);
    expect(s[11]!.month).toBe('2026-11');
    expect(s[10]!.total).toBe(500n);
  });
});

describe('documents', () => {
  it('vehicle ids are kept by the orphan sweep and use their own slots', () => {
    const ids = liveDocPropertyIds([{ id: 'v1', record_kind: 'vehicle', data: {} }, { id: 'l1', record_kind: 'licence', data: {} }]);
    expect(ids.has('v1') && ids.has('l1')).toBe(true);
    expect(slotsOf([], 'IN', ['rc', 'insurance']).map((s) => s.id)).toEqual(['rc', 'insurance']);
  });
});
