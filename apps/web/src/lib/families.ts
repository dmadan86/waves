/**
 * A by-family bill's shares, laid out under their families.
 *
 * The family a share sits under is the one the bill was *written* with (the
 * `units` snapshot in its split params), so moving someone between families
 * later never regroups an old bill. A family id the group no longer has has no
 * name to show, and its people read as ordinary rows.
 */

import { parseMajor, unitsSplitParams, type GroupUnits, type UnitsParams } from '@waves/core';

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

/** The by-family split for an equal bill: a saved bill keeps the composition it
 *  was written with until the person changes the people or the method. */
export function equalFamilyParams(
  snapshot: UnitsParams | null,
  touched: boolean,
  units: GroupUnits | null | undefined,
  participants: readonly string[],
): UnitsParams {
  return snapshot && !touched ? snapshot : unitsSplitParams(units, participants);
}

/** The family rows use the same text fields as the person editor. */
export function familyParamsFor(input: {
  units: GroupUnits | null | undefined;
  participants: readonly string[];
  kind: 'equal' | 'shares' | 'exact' | 'percent';
  bySize: boolean;
  currency: string;
  exact: Readonly<Record<string, string>>;
  percent: Readonly<Record<string, string>>;
  weights: Readonly<Record<string, string>>;
}): UnitsParams {
  const base = unitsSplitParams(
    input.units,
    input.participants,
    input.kind === 'equal' && input.bySize,
  );
  const ids = Object.keys(base.units);
  if (input.kind === 'equal') return base;
  if (input.kind === 'exact')
    return {
      ...base,
      mode: 'exact',
      amounts: Object.fromEntries(
        ids.map((id) => [id, parseMajor(input.exact[id]?.trim() || '0', input.currency).minor]),
      ),
    };
  const values = Object.fromEntries(
    ids.map((id) => {
      const raw =
        (input.kind === 'percent' ? input.percent[id] : input.weights[id])?.trim() ||
        (input.kind === 'shares' ? '1' : '0');
      if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error('Invalid split value');
      if (input.kind === 'shares') return [id, Number(raw)];
      const [whole = '0', fraction = ''] = raw.split('.');
      return [id, Number(whole) * 100 + Number(fraction.padEnd(2, '0'))];
    }),
  );
  return input.kind === 'shares'
    ? { ...base, mode: 'weights', weights: values }
    : { ...base, mode: 'percent', basisPoints: values };
}
