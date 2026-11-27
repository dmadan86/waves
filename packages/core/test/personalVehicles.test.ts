import { describe, expect, it } from 'vitest';

import {
  cleanCustomFields,
  decodeLicence,
  decodeTxn,
  decodeVehicle,
  encodeLicence,
  encodeTxn,
  encodeVehicle,
  MAX_CUSTOM_FIELDS,
  type PersonalVehicle,
} from '../src';

const base: Omit<PersonalVehicle, 'id'> = {
  type: 'car',
  name: 'Swift',
  registration: 'KA01AB1234',
  makeModel: 'Maruti Swift',
  year: 2019,
  fuel: 'petrol',
  currency: 'INR',
  status: 'active',
  odometer: 42000,
  notes: 'line one\nline two',
  customFields: [{ key: 'FASTag', value: 'HDFC' }],
  renewals: [
    {
      id: 'r1',
      kind: 'insurance',
      label: null,
      dueDate: '2027-03-01',
      remindDaysBefore: 15,
      policyNumber: 'P-1',
      provider: 'Acko',
    },
  ],
};

describe('vehicle codec', () => {
  it('round-trips', () => {
    const { carried: _c, ...back } = decodeVehicle('v1', encodeVehicle(base));
    expect(back).toEqual({ id: 'v1', ...base });
  });
  it('keeps fields a newer app wrote', () => {
    const d = decodeVehicle('v1', { ...encodeVehicle(base), future: 7 });
    expect(encodeVehicle(d).future).toBe(7);
  });
  it('tolerates garbage', () => {
    const d = decodeVehicle('v', {
      type: 'rocket',
      year: 'x',
      renewals: [{ id: 'a', dueDate: 'soon' }, 5, { id: 'b', kind: 'zzz', dueDate: '2027-01-02' }],
    });
    expect(d.type).toBe('other');
    expect(d.year).toBeNull();
    expect(d.renewals).toHaveLength(1);
    expect(d.renewals[0]).toMatchObject({ kind: 'other', remindDaysBefore: 15 });
  });
  it('caps and trims custom fields', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ key: ` k${i} `, value: 'v' }));
    expect(cleanCustomFields(many)).toHaveLength(MAX_CUSTOM_FIELDS);
    expect(
      cleanCustomFields([
        { key: '  ', value: 'x' },
        { key: 'a'.repeat(99), value: 'b' },
      ]),
    ).toEqual([{ key: 'a'.repeat(40), value: 'b' }]);
  });
});

describe('licence codec', () => {
  it('round-trips', () => {
    const l = {
      holderName: 'Asha',
      number: 'DL-1',
      licenceClass: 'LMV',
      expiry: '2031-03-10',
      remindDaysBefore: 30,
      vehicleIds: ['v1', 'v2'],
    };
    const { carried: _c, ...back } = decodeLicence('l1', encodeLicence(l));
    expect(back).toEqual({ id: 'l1', ...l });
  });
});

describe('vehicle expense tagging', () => {
  const txn = {
    kind: 'expense' as const,
    amount: 123_456_789_012_345_678n,
    currency: 'INR',
    category: 'travel',
    note: null,
    date: '2026-11-01',
    loanId: null,
    recurringId: null,
  };
  it('round-trips the tag and a big amount', () => {
    const d = decodeTxn('t', encodeTxn({ ...txn, vehicleId: 'v1', vehicleKind: 'fuel' }));
    expect(d.vehicleId).toBe('v1');
    expect(d.vehicleKind).toBe('fuel');
    expect(d.amount).toBe(txn.amount);
  });
  it('leaves untagged entries byte-identical', () => {
    expect(encodeTxn(txn)).not.toHaveProperty('vehicleId');
    expect(decodeTxn('t', encodeTxn(txn))).not.toHaveProperty('vehicleId');
  });
});

describe('moved vehicles and expense snapshots', () => {
  it('keeps where a vehicle came from', () => {
    const d = decodeVehicle('v', encodeVehicle({ ...base, movedFrom: 'Personal' }));
    expect(d.movedFrom).toBe('Personal');
    expect(encodeVehicle(decodeVehicle('v', encodeVehicle(base)))).not.toHaveProperty('movedFrom');
  });
  it('snapshots the vehicle name on the expense', () => {
    const t = decodeTxn(
      't',
      encodeTxn({
        kind: 'expense',
        amount: 1n,
        currency: 'INR',
        category: 'travel',
        note: null,
        date: '2026-11-01',
        loanId: null,
        recurringId: null,
        vehicleId: 'v1',
        vehicleKind: 'fuel',
        vehicleName: 'Swift',
      }),
    );
    expect(t.vehicleName).toBe('Swift');
  });
});
