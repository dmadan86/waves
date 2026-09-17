/**
 * The bill editor's arithmetic and its indexing.
 *
 * The indexing is the case worth pinning: claims are keyed by an item's
 * position in the items array, and a row nobody has finished typing is not in
 * that array. If the two drift apart the split still computes — it just puts
 * somebody else's dinner on your bill, with no error anywhere.
 *
 * Amounts are parsed here with a stand-in rather than `parseMajor`, so these
 * test the editor's own logic and not core's money parsing, which has its own.
 */

import { describe, expect, it } from 'vitest';

import {
  billTotal,
  claimants,
  itemizedParams,
  unclaimed,
  type DraftExtras,
  type DraftLine,
} from '../src/lib/itemize';

/** Two-decimal minor units, and null for anything that is not a number yet. */
const parse = (text: string): bigint | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? BigInt(Math.round(value * 100)) : null;
};

const NONE: DraftExtras = { taxes: '', serviceCharge: '', tip: '', discounts: '' };

function line(label: string, amountText: string, ...claimers: string[]): DraftLine {
  return { label, amountText, claimers };
}

describe('itemizedParams', () => {
  it('keys each claim by the position the line takes, not the row it was typed in', () => {
    const lines = [
      // A half-typed row between two real ones: the trap this exists for.
      line('Starter', '480', 'asha'),
      line('', '', 'ravi'),
      line('Beer', '1240', 'ravi'),
    ];

    const params = itemizedParams(lines, NONE, parse);

    expect(params?.items).toEqual([
      { label: 'Starter', total: 48000n },
      { label: 'Beer', total: 124000n },
    ]);
    // Beer is item 1, not item 2 — the blank row never became an item.
    expect(params?.claims).toEqual({ 0: ['asha'], 1: ['ravi'] });
  });

  it('leaves an unnamed line unnamed rather than inventing a label', () => {
    const params = itemizedParams([line('   ', '100')], NONE, parse);
    expect(params?.items[0]).toEqual({ label: undefined, total: 10000n });
  });

  it('carries an unclaimed line through, so the split refuses it rather than this', () => {
    // Core throws UnclaimedItem. Dropping the line here would silently divide a
    // bill that nobody has finished assigning.
    const params = itemizedParams([line('Beer', '1240')], NONE, parse);
    expect(params?.claims).toEqual({ 0: [] });
  });

  it('is null until something carries an amount', () => {
    expect(itemizedParams([line('Beer', ''), line('', '')], NONE, parse)).toBeNull();
    expect(itemizedParams([], NONE, parse)).toBeNull();
  });

  it('passes the extras through, and omits the ones nobody typed', () => {
    const params = itemizedParams(
      [line('Beer', '1240', 'ravi')],
      { ...NONE, taxes: '86.40' },
      parse,
    );
    expect(params?.taxes).toBe(8640n);
    expect(params?.serviceCharge).toBeUndefined();
    expect(params?.tip).toBeUndefined();
    expect(params?.discounts).toBeUndefined();
  });
});

describe('billTotal', () => {
  it('adds the lines, the tax, the service and the tip, and takes off the discount', () => {
    const lines = [line('Starter', '480', 'asha'), line('Beer', '1240', 'ravi')];
    const extras: DraftExtras = {
      taxes: '86.40',
      serviceCharge: '172',
      tip: '20',
      discounts: '50',
    };
    // 1720 + 86.40 + 172 + 20 − 50
    expect(billTotal(lines, extras, parse)).toBe(194840n);
  });

  it('treats a half-typed row as nothing rather than as zero-and-counted', () => {
    expect(billTotal([line('Beer', '1240', 'ravi'), line('', '')], NONE, parse)).toBe(124000n);
  });
});

describe('claimants', () => {
  it('is everybody who claimed a line that counts, each once', () => {
    const lines = [
      line('Starter', '480', 'asha', 'ravi'),
      line('Beer', '1240', 'ravi'),
      // Claimed, but not yet a line — this person is not on the bill.
      line('Dessert', '', 'meera'),
    ];
    expect(claimants(lines, parse)).toEqual(['asha', 'ravi']);
  });
});

describe('unclaimed', () => {
  it('names the lines that carry an amount but that nobody has taken', () => {
    const lines = [line('Starter', '480', 'asha'), line('Beer', '1240'), line('Dessert', '')];
    expect(unclaimed(lines, parse).map((row) => row.label)).toEqual(['Beer']);
  });
});
