/**
 * Families ("units") inside a group.
 *
 * A unit is a group-level grouping of members stored on `groups.units`; the
 * ledger stays per person and the family is a lens over it. Nothing here
 * touches money arithmetic: `unitsSplitParams` only names who sits together
 * (the `units` split kind in `split/` does the division) and `unitNetBalances`
 * only adds up balances that already exist.
 *
 * Anyone not in a unit is an implicit unit of one, keyed by their own member
 * id, so `simplify()` and settle-up run unchanged over the mixed map.
 */

import type { NetBalances } from '../balances/types';
import type { MemberId, UnitsParams } from '../split/types';

export interface GroupUnit {
  /** Trimmed, 1..MAX_UNIT_NAME characters. */
  readonly name: string;
  readonly members: readonly MemberId[];
  /** Who settles for the family; one of `members`. Absent means the first. */
  readonly head?: MemberId;
  readonly weights?: Readonly<Record<MemberId, number>>;
}

/** `groups.units`: unit id → unit. */
export type GroupUnits = Readonly<Record<string, GroupUnit>>;

export const MAX_UNITS = 50;
export const MAX_UNIT_NAME = 24;

/**
 * A unit's members as this build can read them: the map is validated on the
 * way in, but a reader must not crash on a row written past that boundary
 * (a malformed entry reads as a family with nobody in it).
 */
export function unitMembers(unit: GroupUnit | null | undefined): readonly MemberId[] {
  const members = (unit as { members?: unknown } | null | undefined)?.members;
  return Array.isArray(members)
    ? members.filter((member): member is MemberId => typeof member === 'string')
    : [];
}

/** The unit a member belongs to, or null for a unit of one. */
export function unitOf(units: GroupUnits | null | undefined, memberId: MemberId): string | null {
  if (!units) return null;
  for (const [unitId, unit] of Object.entries(units)) {
    if (unitMembers(unit).includes(memberId)) return unitId;
  }
  return null;
}

/** Who settles for a unit: its head when still a member, else its first member. */
export function headOf(unit: GroupUnit): MemberId | undefined {
  const members = unitMembers(unit);
  return unit.head && members.includes(unit.head) ? unit.head : members[0];
}

/** Members in no unit, in the order given. */
export function unassignedMembers(
  units: GroupUnits | null | undefined,
  members: readonly MemberId[],
): MemberId[] {
  return members.filter((member) => unitOf(units, member) === null);
}

/**
 * The `units` split for this bill: each family's members among the
 * participants (families with nobody in the bill are left out), and every
 * participant in no family as a unit of one keyed by their member id.
 */
export function unitsSplitParams(
  units: GroupUnits | null | undefined,
  participants: readonly MemberId[],
  bySize = false,
): UnitsParams {
  const chosen = new Set(participants);
  const snapshot: Record<string, MemberId[]> = {};
  const placed = new Set<MemberId>();
  const memberWeights: Record<string, number> = {};
  for (const [unitId, unit] of Object.entries(units ?? {})) {
    const members = unitMembers(unit).filter((member) => chosen.has(member) && !placed.has(member));
    if (members.length === 0) continue;
    snapshot[unitId] = members;
    for (const member of members) {
      placed.add(member);
      const weight = unit.weights?.[member] ?? 1;
      if (weight !== 1) memberWeights[member] = weight;
    }
  }
  for (const member of participants) {
    if (!placed.has(member)) snapshot[member] = [member];
  }
  return {
    kind: 'units',
    units: snapshot,
    ...(bySize ? { bySize: true } : {}),
    ...(Object.keys(memberWeights).length ? { memberWeights } : {}),
  };
}

/** Per-member balances rolled up by unit: a family's balance is the sum of its
 *  members', a person in no family keeps their own key. Σ is unchanged. */
export function unitBalances(
  balances: ReadonlyMap<MemberId, bigint>,
  units: GroupUnits | null | undefined,
): Map<string, bigint> {
  const rolled = new Map<string, bigint>();
  for (const [member, balance] of balances) {
    const key = unitOf(units, member) ?? member;
    rolled.set(key, (rolled.get(key) ?? 0n) + balance);
  }
  return rolled;
}

/** `unitBalances` for every currency, shaped for `simplify()`. */
export function unitNetBalances(
  net: NetBalances,
  units: GroupUnits | null | undefined,
): NetBalances {
  const rolled: NetBalances = new Map();
  for (const [currency, perMember] of net) rolled.set(currency, unitBalances(perMember, units));
  return rolled;
}

/** A transfer between units, said as the two heads so `settlement.create` can record it. */
export function headsFor(units: GroupUnits | null | undefined, key: string): MemberId | undefined {
  const unit = units?.[key];
  return unit ? headOf(unit) : key;
}

/**
 * Canonical deep-equal for two `groups.units` values, used by the sync
 * content guard.
 *
 * Key-order-insensitive: `{ a: …, b: … }` equals `{ b: …, a: … }`.
 * Null and an empty object are treated as equal (both mean "no families").
 * Member-list order IS significant — a reorder is a real edit.
 */
export function unitsEqual(
  a: GroupUnits | null | undefined,
  b: GroupUnits | null | undefined,
): boolean {
  // Normalise: null / undefined / {} → canonical empty sentinel.
  const aEntries = Object.entries(a ?? {});
  const bEntries = Object.entries(b ?? {});
  if (aEntries.length === 0 && bEntries.length === 0) return true;
  if (aEntries.length !== bEntries.length) return false;

  const bMap = new Map(bEntries);
  for (const [id, aUnit] of aEntries) {
    const bUnit = bMap.get(id);
    if (!bUnit) return false;
    if (aUnit.name !== bUnit.name) return false;
    const aMembers = unitMembers(aUnit);
    const bMembers = unitMembers(bUnit);
    if (aMembers.length !== bMembers.length) return false;
    if (aMembers.some((m, i) => m !== bMembers[i])) return false;
    // Absent head and undefined head are both "no explicit head" — equal.
    const aHead = aUnit.head ?? null;
    const bHead = bUnit.head ?? null;
    if (aHead !== bHead) return false;
    for (const member of new Set([
      ...Object.keys(aUnit.weights ?? {}),
      ...Object.keys(bUnit.weights ?? {}),
    ])) {
      if ((aUnit.weights?.[member] ?? 1) !== (bUnit.weights?.[member] ?? 1)) return false;
    }
  }
  return true;
}

export type UnitsVerdict = { ok: true; units: GroupUnits | null } | { ok: false; reason: string };

/**
 * `groups.units` as a boundary reads it: an object of at most MAX_UNITS units,
 * each with a trimmed name of 1..MAX_UNIT_NAME characters and at least one
 * member; every member id one of `memberIds`; nobody in two units; the head,
 * when given, one of the unit's members. Null (or an empty object) clears the
 * families. The returned map is the normalised copy to store.
 */
export function validateGroupUnits(raw: unknown, memberIds: ReadonlySet<MemberId>): UnitsVerdict {
  if (raw === null || raw === undefined) return { ok: true, units: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'units must be an object' };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { ok: true, units: null };
  if (entries.length > MAX_UNITS) return { ok: false, reason: `at most ${MAX_UNITS} families` };
  const units: Record<string, GroupUnit> = {};
  const placed = new Set<MemberId>();
  for (const [unitId, value] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(unitId))
      return { ok: false, reason: `bad unit id ${unitId}` };
    // A family id shares a key space with the member ids of people in no family
    // (rollups key by `unitOf(...) ?? memberId`), so a collision would merge two
    // balances into one and net real debts away.
    if (memberIds.has(unitId)) return { ok: false, reason: `unit id ${unitId} is a member id` };
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, reason: `unit ${unitId} must be an object` };
    }
    const unit = value as Record<string, unknown>;
    const name = typeof unit.name === 'string' ? unit.name.trim() : '';
    if (name.length === 0 || name.length > MAX_UNIT_NAME) {
      return { ok: false, reason: `a family name is 1 to ${MAX_UNIT_NAME} characters` };
    }
    if (!Array.isArray(unit.members) || unit.members.length === 0) {
      return { ok: false, reason: `family "${name}" needs at least one member` };
    }
    const members: MemberId[] = [];
    for (const member of unit.members) {
      if (typeof member !== 'string' || !memberIds.has(member)) {
        return { ok: false, reason: `family "${name}" names someone not in this group` };
      }
      if (placed.has(member)) return { ok: false, reason: `${member} is in two families` };
      placed.add(member);
      members.push(member);
    }
    if (unit.head !== undefined && unit.head !== null) {
      if (typeof unit.head !== 'string' || !members.includes(unit.head)) {
        return { ok: false, reason: `family "${name}" has a head who is not in it` };
      }
    }
    const weights: Record<string, number> = {};
    if (unit.weights !== undefined) {
      if (
        typeof unit.weights !== 'object' ||
        unit.weights === null ||
        Array.isArray(unit.weights)
      ) {
        return { ok: false, reason: 'weights must be an object' };
      }
      for (const [member, weight] of Object.entries(unit.weights)) {
        if (
          !members.includes(member) ||
          typeof weight !== 'number' ||
          !Number.isFinite(weight) ||
          weight <= 0 ||
          weight > 10
        ) {
          return {
            ok: false,
            reason: 'member weights must be in (0, 10] and name a family member',
          };
        }
        if (weight !== 1) weights[member] = weight;
      }
    }
    units[unitId] = {
      name,
      ...(Object.keys(weights).length ? { weights } : {}),
      members,
      ...(typeof unit.head === 'string' ? { head: unit.head } : {}),
    };
  }
  return { ok: true, units };
}

/** Render a saved bill using its own membership and weights, with today's family names. */
export function unitsFromSnapshot(
  split: UnitsParams,
  units: GroupUnits | null | undefined,
  nameOf: (member: MemberId) => string = (id) => id,
): GroupUnits {
  return Object.fromEntries(
    Object.entries(split.units)
      .filter(([id, members]) => members.length !== 1 || members[0] !== id)
      .map(([id, members]) => [
        id,
        {
          name: units?.[id]?.name ?? members.map(nameOf).join(', '),
          members,
          weights: Object.fromEntries(
            members
              .filter((member) => split.memberWeights?.[member] !== undefined)
              .map((member) => [member, split.memberWeights![member]!]),
          ),
        },
      ]),
  );
}
