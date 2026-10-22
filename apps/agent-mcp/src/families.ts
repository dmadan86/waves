/**
 * Families ("units") for the agent: `groups.units` read the way `@waves/core`'s
 * `group/units.ts` reads it, inlined because this server deliberately depends on
 * nothing in the workspace. Someone in no family is a family of one, keyed by
 * their own member id, so the same simplify runs over the mixed map.
 */

import type { NetRow } from './settle';

/** `groups.units`: family id → { name, members, head? }. */
export type Units = Record<string, { name?: unknown; members?: unknown; head?: unknown }>;

const membersOf = (unit: Units[string] | undefined): string[] =>
  Array.isArray(unit?.members)
    ? unit.members.filter((m): m is string => typeof m === 'string')
    : [];

/** The family a member sits in, or null for a family of one. */
export function unitIdOf(units: Units | null | undefined, memberId: string): string | null {
  for (const [id, unit] of Object.entries(units ?? {})) {
    if (membersOf(unit).includes(memberId)) return id;
  }
  return null;
}

export function unitName(units: Units | null | undefined, id: string): string | null {
  const name = units?.[id]?.name;
  return typeof name === 'string' ? name : null;
}

/** Who settles for a family: its head when still in it, else its first member. */
export function headOf(units: Units | null | undefined, id: string): string {
  const unit = units?.[id];
  const members = membersOf(unit);
  return typeof unit?.head === 'string' && members.includes(unit.head)
    ? unit.head
    : (members[0] ?? id);
}

/** `group_balances` rows rolled up by family (Σ unchanged); `member_id` becomes the family key. */
export function rollUpByFamily(rows: readonly NetRow[], units: Units | null | undefined): NetRow[] {
  const rolled = new Map<string, NetRow>();
  for (const row of rows) {
    const key = unitIdOf(units, row.member_id) ?? row.member_id;
    const id = `${key}\u0000${row.currency}`;
    const prev = rolled.get(id);
    rolled.set(id, {
      member_id: key,
      currency: row.currency,
      balance: BigInt(prev?.balance ?? 0) + BigInt(row.balance),
    });
  }
  return [...rolled.values()];
}
