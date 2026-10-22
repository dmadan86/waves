/**
 * The family lens on the phone: pure helpers over `@waves/core`'s `GroupUnits`
 * that the Families screen, the balances tab, settle-up and the split editor
 * read. Nothing here computes money — a family's balance is the sum its
 * members already have, and the split itself is core's `units` kind.
 */

import {
  headsFor,
  simplify,
  unitMembers,
  unitNetBalances,
  unitOf,
  type GroupUnit,
  type GroupUnits,
  type MemberId,
  type NetBalances,
  type Transfer,
} from '@waves/core';

export interface FamilyGroup<M extends { id: MemberId }> {
  readonly id: string;
  readonly unit: GroupUnit;
  /** The family's members among `members`, in the family's own order. */
  readonly members: readonly M[];
}

/** Whether the group has at least one family. */
export function hasFamilies(units: GroupUnits | null | undefined): boolean {
  return Boolean(units && Object.keys(units).length > 0);
}

/** The families with their member rows, then everyone in no family. Members
 *  the family names but the list does not have (departed, not loaded) are
 *  skipped, and so is an entry that is not a family at all (no name, no
 *  member list) — the map is validated on write, but a reader never crashes on it. */
export function familyRows<M extends { id: MemberId }>(
  units: GroupUnits | null | undefined,
  members: readonly M[],
): { families: FamilyGroup<M>[]; onTheirOwn: M[] } {
  const byId = new Map(members.map((member) => [member.id, member]));
  const placed = new Set<MemberId>();
  const families: FamilyGroup<M>[] = [];
  for (const [id, unit] of Object.entries(units ?? {})) {
    if (typeof unit?.name !== 'string' || !Array.isArray(unit.members)) continue;
    const rows = unitMembers(unit)
      .map((memberId) => byId.get(memberId))
      .filter((member): member is M => member !== undefined && !placed.has(member.id));
    for (const member of rows) placed.add(member.id);
    families.push({ id, unit, members: rows });
  }
  return { families, onTheirOwn: members.filter((member) => !placed.has(member.id)) };
}

/** The family a member is in, or null. */
export function familyOf(
  units: GroupUnits | null | undefined,
  memberId: MemberId,
): (GroupUnit & { id: string }) | null {
  const id = unitOf(units, memberId);
  const unit = id ? units?.[id] : undefined;
  return id && unit ? { id, ...unit } : null;
}

export type FamilyBalanceItem<M extends { id: MemberId }> =
  | { kind: 'family'; id: string; name: string; members: readonly M[]; balance: bigint }
  | { kind: 'person'; member: M; balance: bigint };

/**
 * The balances list in the family lens: one item per family (its members'
 * balances added up) and one per person on their own, in the order the
 * members list has them. `members` is already filtered the way the tab
 * filters it (departed people only while they still owe or are owed).
 */
export function familyBalanceItems<M extends { id: MemberId }>(
  units: GroupUnits | null | undefined,
  members: readonly M[],
  balances: ReadonlyMap<MemberId, bigint>,
): FamilyBalanceItem<M>[] {
  const { families, onTheirOwn } = familyRows(units, members);
  const items: FamilyBalanceItem<M>[] = families
    .filter((family) => family.members.length > 0)
    .map((family) => ({
      kind: 'family',
      id: family.id,
      name: family.unit.name,
      members: family.members,
      balance: family.members.reduce((sum, member) => sum + (balances.get(member.id) ?? 0n), 0n),
    }));
  for (const member of onTheirOwn) {
    items.push({ kind: 'person', member, balance: balances.get(member.id) ?? 0n });
  }
  return items;
}

/**
 * Who pays whom when families settle as one: `simplify` over the family
 * balances, each family then named by its head so the existing
 * `settlement.create` (member → member) records it. A person on their own is
 * their own head. Families whose head is unknown (an empty family) are
 * dropped — there is nobody to pay.
 */
export function familyTransfers(
  net: NetBalances,
  units: GroupUnits | null | undefined,
): Transfer[] {
  const transfers: Transfer[] = [];
  for (const transfer of simplify(unitNetBalances(net, units))) {
    const from = headsFor(units, transfer.from);
    const to = headsFor(units, transfer.to);
    if (from && to && from !== to) transfers.push({ ...transfer, from, to });
  }
  return transfers;
}

/** "Sharma family (Ravi)" for a head on a family-lens settle row; the plain
 *  name for anyone on their own. */
export function familyLabel(
  units: GroupUnits | null | undefined,
  memberId: MemberId,
  name: string,
): string {
  const family = familyOf(units, memberId);
  return family ? `${family.name} (${name})` : name;
}

/** `units` with family `id` set to `unit`, or removed when `unit` is null; null once empty. */
export function withFamily(
  units: GroupUnits | null | undefined,
  id: string,
  unit: GroupUnit | null,
): GroupUnits | null {
  const next: Record<string, GroupUnit> = { ...(units ?? {}) };
  if (unit === null) delete next[id];
  else next[id] = unit;
  return Object.keys(next).length === 0 ? null : next;
}

/** `units` with `memberId` in exactly `familyId` (null: in none). The head
 *  follows them out when they leave a family. */
export function placeMember(
  units: GroupUnits | null | undefined,
  memberId: MemberId,
  familyId: string | null,
): GroupUnits | null {
  let next: GroupUnits | null = units ?? null;
  const current = unitOf(next, memberId);
  if (current && current !== familyId) {
    const unit = next?.[current];
    if (unit) {
      const members = unitMembers(unit).filter((member) => member !== memberId);
      next = withFamily(
        next,
        current,
        members.length === 0
          ? null
          : { ...unit, members, ...(unit.head === memberId ? { head: members[0] } : {}) },
      );
    }
  }
  if (familyId && current !== familyId) {
    const unit = next?.[familyId];
    if (unit) {
      next = withFamily(next, familyId, { ...unit, members: [...unitMembers(unit), memberId] });
    }
  }
  return next;
}
