/**
 * Pure rules for Vehicles: free cap, renewal due-soon and reminder dates, per-vehicle spend,
 * and the regional words/units. Region only changes display hints, never a stored value.
 */

import {
  addPlanDays,
  monthKey,
  recentMonths,
  type PersonalLicence,
  type PersonalTxn,
  type PersonalVehicle,
  type RenewalKind,
  type VehicleExpenseKind,
  type VehicleRenewal,
} from '@waves/core';

import { REMIND_HOUR, type Region } from '@/lib/wealthPlan';

export const FREE_VEHICLES = 1;
export const atVehicleLimit = (activeCount: number, isPro: boolean): boolean =>
  !isPro && activeCount >= FREE_VEHICLES;

/** Active vehicles this person added (a row still queued has no author and is theirs). */
export const ownActiveVehicles = (
  records: readonly { id: string; record_kind: string; data: Record<string, unknown>; created_by?: string | null }[],
  myMemberId: string | null,
): number =>
  records.filter(
    (r) =>
      r.record_kind === 'vehicle' &&
      r.data.status !== 'sold' &&
      (!r.created_by || r.created_by === myMemberId),
  ).length;

// ───────────────────────────────────────────────────────────── regions ──

/** A regional product name for a renewal kind, shown beside the generic word. Null = generic only. */
export function renewalHint(kind: RenewalKind, region: Region): string | null {
  switch (region) {
    case 'IN':
      return kind === 'emission_test' ? 'Pollution (PUC)' : null;
    case 'GB':
      return kind === 'inspection' ? 'MOT' : null;
    case 'US':
      return kind === 'inspection' ? 'Inspection' : null;
    case 'AE':
      return kind === 'registration' ? 'Registration renewal' : null;
    case 'AU':
      return kind === 'registration' ? 'Rego' : kind === 'inspection' ? 'Roadworthy' : null;
    default:
      return null;
  }
}

/** UK and US drive in miles; everyone else in km. */
export const distanceUnit = (region: Region): 'km' | 'mi' =>
  region === 'GB' || region === 'US' ? 'mi' : 'km';
/** Only the US buys fuel by the gallon. */
export const fuelVolumeUnit = (region: Region): 'L' | 'gal' => (region === 'US' ? 'gal' : 'L');

// ─────────────────────────────────────────────────────────── renewals ──

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
export const daysUntil = (today: string, date: string): number => dayNumber(date) - dayNumber(today);

/** Overdue renewals stay visible this many days: past that the record is stale, not urgent. */
export const OVERDUE_GRACE_DAYS = 60;

/** Inside its reminder window (or overdue within the grace period). */
export function isDueSoon(due: string, remindDaysBefore: number, today: string): boolean {
  const n = daysUntil(today, due);
  return n <= remindDaysBefore && n >= -OVERDUE_GRACE_DAYS;
}

export interface DueItem {
  readonly key: string;
  readonly kind: RenewalKind | 'licence';
  readonly label: string | null;
  readonly date: string;
  readonly inDays: number;
  readonly vehicleId: string | null;
}

/** Renewals in their window, soonest (most overdue) first. */
export function dueSoon(
  vehicle: Pick<PersonalVehicle, 'id' | 'renewals'>,
  today: string,
): DueItem[] {
  return vehicle.renewals
    .filter((r) => isDueSoon(r.dueDate, r.remindDaysBefore, today))
    .map((r) => ({
      key: `${vehicle.id}:${r.id}`,
      kind: r.kind,
      label: r.label,
      date: r.dueDate,
      inDays: daysUntil(today, r.dueDate),
      vehicleId: vehicle.id,
    }))
    .sort((a, b) => a.inDays - b.inDays);
}

export function licenceDue(l: PersonalLicence, today: string): DueItem | null {
  if (!l.expiry || !isDueSoon(l.expiry, l.remindDaysBefore, today)) return null;
  return {
    key: `licence:${l.id}`,
    kind: 'licence',
    label: null,
    date: l.expiry,
    inDays: daysUntil(today, l.expiry),
    vehicleId: null,
  };
}

/** The next unexpired renewal date of a kind, for the add form's two quick dates. */
export const renewalOf = (v: Pick<PersonalVehicle, 'renewals'>, kind: RenewalKind): VehicleRenewal | undefined =>
  v.renewals.find((r) => r.kind === kind);

// ────────────────────────────────────────────────────────── reminders ──

export interface VehicleReminder {
  readonly id: string;
  readonly fireAt: number;
  readonly kind: RenewalKind | 'licence';
  readonly label: string | null;
  readonly name: string;
  readonly days: number;
  readonly url: string;
}

const at10 = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, REMIND_HOUR, 0, 0, 0).getTime();
};

/**
 * One notification per renewal, `remindDaysBefore` days ahead at 10:00, only while that moment is
 * still in the future. A renewal already inside its window is shown in Upcoming, not re-sent.
 */
export function planVehicleReminders(input: {
  vehicles: readonly PersonalVehicle[];
  licences: readonly PersonalLicence[];
  now: number;
  limit?: number;
}): VehicleReminder[] {
  const out: VehicleReminder[] = [];
  const push = (r: VehicleReminder): void => {
    if (r.fireAt > input.now) out.push(r);
  };
  for (const v of input.vehicles) {
    if (v.status !== 'active') continue;
    for (const r of v.renewals)
      push({
        id: `veh:${v.id}:${r.id}:${r.dueDate}`,
        fireAt: at10(addPlanDays(r.dueDate, -r.remindDaysBefore)),
        kind: r.kind,
        label: r.label,
        name: v.name,
        days: r.remindDaysBefore,
        url: `waves://vehicles/${v.id}`,
      });
  }
  for (const l of input.licences)
    if (l.expiry)
      push({
        id: `lic:${l.id}:${l.expiry}`,
        fireAt: at10(addPlanDays(l.expiry, -l.remindDaysBefore)),
        kind: 'licence',
        label: null,
        name: l.holderName,
        days: l.remindDaysBefore,
        url: 'waves://vehicles',
      });
  return out.sort((a, b) => a.fireAt - b.fireAt).slice(0, input.limit ?? 20);
}

// ───────────────────────────────────────────────────────────── spend ──

export const vehicleTxns = (txns: readonly PersonalTxn[], vehicleId: string): PersonalTxn[] =>
  txns.filter((t) => t.kind === 'expense' && t.vehicleId === vehicleId);

/** Spend in one month and one currency (a vehicle's own). */
export function monthSpend(
  txns: readonly PersonalTxn[],
  vehicleId: string | null,
  month: string,
  currency: string,
): bigint {
  let total = 0n;
  for (const t of txns)
    if (
      t.kind === 'expense' &&
      t.vehicleId &&
      (vehicleId === null || t.vehicleId === vehicleId) &&
      t.currency === currency &&
      monthKey(t.date) === month
    )
      total += t.amount;
  return total;
}

export interface SpendMonth {
  readonly month: string;
  readonly total: bigint;
}
/** The last 12 months, oldest first, ending with the current one. */
export function spendStrip(
  txns: readonly PersonalTxn[],
  vehicleId: string,
  today: string,
  currency: string,
): SpendMonth[] {
  return recentMonths(monthKey(today), 12).map((month) => ({
    month,
    total: monthSpend(txns, vehicleId, month, currency),
  }));
}

/** Every vehicle expense is a Travel entry in Reports; the kind keeps the detail. */
export const VEHICLE_CATEGORY = 'travel';

export const EXPENSE_NOTE: Record<VehicleExpenseKind, string> = {
  fuel: 'Fuel',
  service: 'Service',
  insurance: 'Insurance',
  tax: 'Tax',
  toll_parking: 'Toll / parking',
  repair: 'Repair',
  other: '',
};

/** Licence class and number never enter an entry note: only the vehicle's own name does. */
export const expenseNote = (kind: VehicleExpenseKind, vehicleName: string, typed: string): string =>
  typed.trim() || [EXPENSE_NOTE[kind], vehicleName].filter(Boolean).join(' · ');
