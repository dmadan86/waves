/** Vehicles and the driving licence, read from and written to the same store Rentals use (Personal or a couple/home space). */

import { useMemo } from 'react';
import { randomUUID } from 'expo-crypto';

import {
  decodeLicence,
  decodeVehicle,
  encodeLicence,
  encodeTxn,
  encodeVehicle,
  type CurrencyCode,
  type FuelType,
  type PersonalLicence,
  type PersonalVehicle,
  type VehicleExpenseKind,
  type VehicleRenewal,
  type VehicleType,
} from '@waves/core';

import { useMyMemberId, useRentalStore, type RentalStore } from '@/data/personalWealth';
import { useEntitlement } from '@/lib/useEntitlement';
import { expenseNote, FREE_VEHICLES, ownActiveVehicles, VEHICLE_CATEGORY } from '@/lib/vehiclePlan';
import { runMove, startMove, type MoveRecord } from '@/lib/vehicleMove';
import { readMoves, rekeyDocs, saveMove } from '@/lib/propertyDocs';

export const FREE_VEHICLE_CAP_ERROR = 'FREE_VEHICLE_CAP';
let pendingVehicles = 0;

export interface VehicleStore {
  readonly vehicles: readonly PersonalVehicle[];
  readonly licences: readonly PersonalLicence[];
}

export function usePersonalVehicles(groupId?: string): VehicleStore {
  const { records } = useRentalStore(groupId);
  return useMemo(() => {
    const vehicles: PersonalVehicle[] = [];
    const licences: PersonalLicence[] = [];
    for (const r of records) {
      if (r.record_kind === 'vehicle') vehicles.push(decodeVehicle(r.id, r.data));
      else if (r.record_kind === 'licence') licences.push(decodeLicence(r.id, r.data));
    }
    vehicles.sort((a, b) => a.name.localeCompare(b.name));
    return { vehicles, licences };
  }, [records]);
}

export function useOwnVehicleCount(groupId?: string): number {
  const { records } = useRentalStore(groupId);
  const me = useMyMemberId(groupId);
  return ownActiveVehicles(records, me);
}

export interface VehicleDraft {
  type: VehicleType;
  name: string;
  registration: string | null;
  makeModel: string | null;
  year: number | null;
  fuel: FuelType;
  currency: CurrencyCode;
  renewals: VehicleRenewal[];
}

/** The store-level write used by moves too: the same record, byte for byte, into another store. */
export const putVehicle = (store: RentalStore, v: PersonalVehicle): Promise<unknown> => {
  const { id, ...rest } = v;
  return store.upsert(id, 'vehicle', encodeVehicle(rest));
};

export function useVehicleWrites(groupId?: string) {
  const store = useRentalStore(groupId);
  const { isPro } = useEntitlement();
  const me = useMyMemberId(groupId);
  return {
    async createVehicle(d: VehicleDraft): Promise<string> {
      const count = ownActiveVehicles(store.records, me);
      if (!isPro && count + pendingVehicles >= FREE_VEHICLES)
        throw new Error(FREE_VEHICLE_CAP_ERROR);
      pendingVehicles += 1;
      try {
        const id = randomUUID();
        await putVehicle(store, {
          id,
          ...d,
          status: 'active',
          odometer: null,
          notes: null,
          customFields: [],
        });
        return id;
      } finally {
        pendingVehicles -= 1;
      }
    },
    saveVehicle: (v: PersonalVehicle) => putVehicle(store, v),
    saveLicence: (l: PersonalLicence) => {
      const { id, ...rest } = l;
      return store.upsert(id, 'licence', encodeLicence(rest));
    },
    deleteRecord: (id: string) => store.del(id),
    /** A vehicle expense is an ordinary entry, so it shows in Transactions and Reports. */
    addExpense: (
      v: PersonalVehicle,
      kind: VehicleExpenseKind,
      amount: bigint,
      date: string,
      note: string,
      /** The kind's word in the person's language, used when no note was typed. */
      kindLabel: string,
    ) =>
      store.upsert(
        randomUUID(),
        'txn',
        encodeTxn({
          kind: 'expense',
          amount,
          currency: v.currency,
          category: VEHICLE_CATEGORY,
          note: expenseNote(kindLabel, v.name, note),
          date,
          loanId: null,
          recurringId: null,
          vehicleId: v.id,
          vehicleKind: kind,
          vehicleName: v.name,
        }),
      ),
  };
}

/**
 * Move a vehicle to another store (resumable, see lib/vehicleMove): the record is saved first, the same
 * target id is reused on a retry, and the source is removed last.
 */
export async function moveVehicle(
  vehicle: PersonalVehicle,
  where: {
    source: RentalStore;
    target: RentalStore;
    targetSpace: string | null;
    sourceSpace: string | null;
    from: string;
  },
): Promise<void> {
  const first = startMove(
    await readMoves(),
    vehicle.id,
    where.targetSpace,
    randomUUID(),
    where.sourceSpace,
  );
  const rec = first.from ? first : { ...first, from: where.from };
  await runMove(rec, {
    put: (r) => putVehicle(where.target, { ...vehicle, id: r.targetId, movedFrom: where.from }),
    rekey: rekeyDocs,
    delSource: () => where.source.del(vehicle.id),
    save: saveMove,
  });
}

/** Finish a move that stopped half way (app killed, offline). The vehicle is read back from the source store. */
export async function resumeMove(
  rec: MoveRecord,
  source: RentalStore,
  target: RentalStore,
): Promise<void> {
  const from = rec.from ?? '';
  const row = source.records.find((r) => r.id === rec.sourceId && r.record_kind === 'vehicle');
  if (rec.step === 'start' && !row) return void (await saveMove(rec, true));
  const vehicle = row ? decodeVehicle(row.id, row.data) : null;
  await runMove(rec, {
    put: (r) =>
      vehicle
        ? putVehicle(target, { ...vehicle, id: r.targetId, movedFrom: from || null })
        : Promise.resolve(),
    rekey: rekeyDocs,
    delSource: () => source.del(rec.sourceId),
    save: saveMove,
  });
}
