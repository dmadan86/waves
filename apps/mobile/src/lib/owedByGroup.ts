export type OwedDirection = 'owed' | 'owe';

export interface OwedContribution {
  groupId: string;
  memberId: string;
  displayName: string;
  currency: string;
  /** Signed from the viewer's side; only viewer-connected edges belong here. */
  net: bigint;
}

export interface OwedGroupMeta {
  groupId: string;
  groupName: string;
  coverEmoji: string | null;
}

export interface OwedGroupRow extends OwedGroupMeta {
  currency: string;
  people: { name: string; amount: bigint }[];
  total: bigint;
}

/** Orient an edge from the viewer's side, excluding debts between other members. */
export function viewerEdge(
  edge: { from: string; to: string; amount: bigint },
  viewerMemberId: string,
): { otherId: string; net: bigint } | null {
  if (edge.from === viewerMemberId) return { otherId: edge.to, net: -edge.amount };
  if (edge.to === viewerMemberId) return { otherId: edge.from, net: edge.amount };
  return null;
}

/** One row per group/currency; amounts in different currencies never mix. */
export function owedByGroup(
  contributions: readonly OwedContribution[],
  groups: readonly OwedGroupMeta[],
  direction: OwedDirection,
): { rows: OwedGroupRow[]; totals: { currency: string; total: bigint }[] } {
  const meta = new Map(groups.map((group) => [group.groupId, group]));
  const rows = new Map<string, OwedGroupRow>();
  const totals = new Map<string, bigint>();
  for (const entry of contributions) {
    if (direction === 'owed' ? entry.net <= 0n : entry.net >= 0n) continue;
    const group = meta.get(entry.groupId);
    if (!group) continue;
    const amount = entry.net < 0n ? -entry.net : entry.net;
    const key = JSON.stringify([entry.groupId, entry.currency]);
    let row = rows.get(key);
    if (!row) {
      row = { ...group, currency: entry.currency, people: [], total: 0n };
      rows.set(key, row);
    }
    row.people.push({ name: entry.displayName, amount });
    row.total += amount;
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0n) + amount);
  }
  return {
    rows: [...rows.values()],
    totals: [...totals].map(([currency, total]) => ({ currency, total })),
  };
}
