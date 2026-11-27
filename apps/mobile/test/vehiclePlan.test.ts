import { describe, expect, it } from 'vitest';

import { decodeTxn, encodeTxn, type PersonalLicence, type PersonalVehicle } from '@waves/core';

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
  expenseNote,
  planVehicleReminders,
  renewalHint,
  spendStrip,
} from '@/lib/vehiclePlan';

const veh = (
  renewals: PersonalVehicle['renewals'],
  extra: Partial<PersonalVehicle> = {},
): PersonalVehicle => ({
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
const txn = (
  id: string,
  date: string,
  amount: bigint,
  vehicleId: string | null,
  currency = 'INR',
) =>
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
  it('two vehicles free, Pro unlimited', () => {
    expect(atVehicleLimit(0, false)).toBe(false);
    expect(atVehicleLimit(1, false)).toBe(false);
    expect(atVehicleLimit(2, false)).toBe(true);
    expect(atVehicleLimit(5, true)).toBe(false);
  });
  it('counts only my active vehicles', () => {
    const rec = (id: string, status: string, by?: string) => ({
      id,
      record_kind: 'vehicle',
      data: { status },
      created_by: by,
    });
    expect(
      ownActiveVehicles(
        [
          rec('a', 'active', 'me'),
          rec('b', 'active', 'other'),
          rec('c', 'sold', 'me'),
          rec('d', 'active'),
        ],
        'me',
      ),
    ).toBe(2);
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
    const l: PersonalLicence = {
      id: 'l',
      holderName: 'A',
      number: null,
      licenceClass: null,
      expiry: '2026-12-01',
      remindDaysBefore: 15,
      vehicleIds: [],
    };
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
    expect(
      planVehicleReminders({
        vehicles: [veh([ren('a', '2030-01-01')], { status: 'sold' })],
        licences: [],
        now: 0,
      }),
    ).toHaveLength(0);
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
  it('vehicle documents use their own slots (there is no orphan sweep to keep them)', () => {
    expect(slotsOf([], 'IN', ['rc', 'insurance']).map((s) => s.id)).toEqual(['rc', 'insurance']);
  });
});

describe('resumable move', () => {
  const rec = {
    sourceId: 'v1',
    targetId: 'n1',
    sourceSpace: null,
    targetSpace: 'g1',
    step: 'start' as const,
  };
  const mk = (failDel = 0) => {
    const log: string[] = [];
    let saved: unknown = undefined;
    let fails = failDel;
    return {
      log,
      saved: () => saved,
      deps: {
        put: async () => void log.push('put'),
        rekey: async (_from: string, _to: string): Promise<void> => void log.push('rekey'),
        delSource: async () => {
          if (fails-- > 0) throw new Error('offline');
          log.push('del');
        },
        save: async (r: unknown, done?: boolean) => void (saved = done ? null : r),
      },
    };
  };
  it('runs the steps in order and clears the record', async () => {
    const { runMove } = await import('@/lib/vehicleMove');
    const m = mk();
    await runMove(rec, m.deps);
    expect(m.log).toEqual(['put', 'rekey', 'del']);
    expect(m.saved()).toBeNull();
  });
  it('a failed source delete leaves a record that resumes with the SAME target id and keeps the docs', async () => {
    const { runMove, startMove } = await import('@/lib/vehicleMove');
    const { rekeyIndex } = await import('@/lib/propertyDocsPure');
    let docs: Record<string, { id: string; name: string; mime: string; size: number }[]> = {
      v1: [{ id: 'd', name: 'rc', mime: 'application/pdf', size: 1 }],
    };
    const m = mk(1);
    m.deps.rekey = async (a: string, b: string) =>
      void (docs = rekeyIndex(docs, a, b) as typeof docs);
    await expect(runMove(rec, m.deps)).rejects.toThrow();
    const left = m.saved() as typeof rec;
    expect(left.step).toBe('rekeyed');
    // The retry asks for a new move: it must get the stored one back, not a fresh id.
    const again = startMove([left], 'v1', 'g1', 'other-id', null);
    expect(again.targetId).toBe('n1');
    await runMove(again, m.deps);
    expect(Object.keys(docs)).toEqual(['n1']);
    expect(m.saved()).toBeNull();
  });
  it('a record already past put does not write the target again', async () => {
    const { runMove } = await import('@/lib/vehicleMove');
    const m = mk();
    await runMove({ ...rec, step: 'rekeyed' }, m.deps);
    expect(m.log).toEqual(['del']);
  });
  it('never removes the source when the target write fails', async () => {
    const { runMove } = await import('@/lib/vehicleMove');
    const m = mk();
    m.deps.put = async () => {
      throw new Error('x');
    };
    await expect(runMove(rec, m.deps)).rejects.toThrow();
    expect(m.log).toEqual([]);
  });
  it('a pending move keeps both ids from the orphan sweep', async () => {
    const { pendingMoveIds } = await import('@/lib/vehicleMove');
    expect([...pendingMoveIds([rec])].sort()).toEqual(['n1', 'v1']);
  });
});

describe('expense notes are localised at creation', () => {
  it('uses the given label, the vehicle name, or what was typed', () => {
    expect(expenseNote('எரிபொருள்', 'Swift', '')).toBe('எரிபொருள் · Swift');
    expect(expenseNote('Fuel', 'Swift', ' full tank ')).toBe('full tank');
    expect(expenseNote('', 'Swift', '')).toBe('Swift');
  });
});

describe('reminders across spaces', () => {
  it('carry the space in the link and cover vehicles from any space', () => {
    const now = new Date(2026, 10, 27, 12).getTime();
    const out = planVehicleReminders({
      vehicles: [
        { ...veh([ren('a', '2027-03-01')]), space: 'g1' },
        veh([ren('b', '2027-04-01')], { id: 'v2' }),
      ],
      licences: [],
      now,
    });
    expect(out.map((r) => r.url).sort()).toEqual([
      'waves://vehicles/v1?space=g1',
      'waves://vehicles/v2',
    ]);
  });
});
