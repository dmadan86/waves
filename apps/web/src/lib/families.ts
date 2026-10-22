/**
 * A by-family bill's shares, laid out under their families.
 *
 * The family a share sits under is the one the bill was *written* with (the
 * `units` snapshot in its split params), so moving someone between families
 * later never regroups an old bill. A family id the group no longer has has no
 * name to show, and its people read as ordinary rows.
 */

import type { GroupUnits, UnitsParams } from '@waves/core';

export interface ShareRow {
  member_id: string;
  amount: string;
}

export interface ShareGroup {
  /** The family's name, or null for a row that stands on its own. */
  name: string | null;
  rows: ShareRow[];
  total: bigint;
}

export function groupSharesByFamily(
  shares: readonly ShareRow[],
  split: Pick<UnitsParams, 'units'> | null,
  units: GroupUnits | null | undefined,
): ShareGroup[] {
  const byMember = new Map(shares.map((share) => [share.member_id, share]));
  const placed = new Set<string>();
  const groups: ShareGroup[] = [];
  const alone = (row: ShareRow): ShareGroup => ({
    name: null,
    rows: [row],
    total: BigInt(row.amount),
  });
  for (const [id, memberIds] of Object.entries(split?.units ?? {})) {
    const rows = memberIds
      .map((memberId) => byMember.get(memberId))
      .filter((row): row is ShareRow => row !== undefined && !placed.has(row.member_id));
    for (const row of rows) placed.add(row.member_id);
    const name = units?.[id]?.name;
    if (name) {
      groups.push({ name, rows, total: rows.reduce((sum, row) => sum + BigInt(row.amount), 0n) });
    } else {
      groups.push(...rows.map(alone));
    }
  }
  for (const share of shares) if (!placed.has(share.member_id)) groups.push(alone(share));
  return groups;
}
