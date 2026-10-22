import { describe, expect, it } from 'vitest';

import type { ParsedReceipt } from '@waves/core';

import { findSplittableReceipt, handoverFor, itemizeParams } from '../src/lib/splitByItem';
import { handoverIsFresh } from '../src/lib/handover';

const parsed = (
  grandTotal: number,
  items = [{ label: 'Fish', total: grandTotal }],
): ParsedReceipt => ({
  merchant: 'Shack',
  date: null,
  currency: 'INR',
  items: items.map((i) => ({ ...i, qty: 1, unitPrice: null, confidence: 0.9 })),
  subtotal: null,
  taxes: [],
  serviceCharge: null,
  tip: null,
  discounts: [],
  grandTotal,
});

const row = (id: string, at: string, p: ParsedReceipt | null, claimed = 0) => ({
  id,
  created_at: at,
  parsed: p,
  claimed,
});

describe('split by item offer', () => {
  it('is offered only when a same-total, unclaimed bill with lines exists', () => {
    const rows = [row('r1', '2026-10-01T10:00:00Z', parsed(120000))];
    expect(findSplittableReceipt(rows, 120000n)?.id).toBe('r1');
    expect(findSplittableReceipt(rows, 100000n)).toBeNull();
    expect(findSplittableReceipt([], 120000n)).toBeNull();
    expect(findSplittableReceipt(undefined, 120000n)).toBeNull();
  });

  it('never offers a bill with no priced lines, no parse, or claims already made', () => {
    expect(findSplittableReceipt([row('a', '2026-10-01', parsed(500, []))], 500n)).toBeNull();
    expect(findSplittableReceipt([row('b', '2026-10-01', null)], 500n)).toBeNull();
    expect(findSplittableReceipt([row('c', '2026-10-01', parsed(500), 2)], 500n)).toBeNull();
  });

  it('takes the newest when two scans match', () => {
    const rows = [
      row('old', '2026-10-01T10:00:00Z', parsed(500)),
      row('new', '2026-10-02T10:00:00Z', parsed(500)),
    ];
    expect(findSplittableReceipt(rows, 500n)?.id).toBe('new');
  });

  it('hands over the parsed lines and receipt id fresh, and replaces the voice entry', () => {
    const match = row('r1', '2026-10-01', parsed(500));
    const handover = handoverFor(match, 1_000);
    expect(handover).toMatchObject({ receiptId: 'r1', at: 1_000 });
    expect(handover.parsed.items).toHaveLength(1);
    expect(handoverIsFresh(handover, 1_000 + 60_000)).toBe(true);
    expect(itemizeParams('g1', 'e1')).toEqual({ id: 'g1', replaces: 'e1' });
  });
});
