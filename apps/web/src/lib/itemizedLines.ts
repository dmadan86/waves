import { parseSplitParams } from '@waves/core';

export interface ItemizedRow {
  label: string;
  total: bigint;
  claimers: string[];
}

/** The lines of an itemised bill with who claimed each, or [] for any other split or an unreadable snapshot. */
export function itemizedRows(splitType: string, splitParams: unknown): ItemizedRow[] {
  if (splitType !== 'itemized') return [];
  try {
    const parsed = parseSplitParams(splitParams);
    if (parsed.kind !== 'itemized') return [];
    return parsed.items.map((item, index) => ({
      label: item.label ?? '',
      total: item.total,
      claimers: [...(parsed.claims[index] ?? [])],
    }));
  } catch {
    return [];
  }
}
