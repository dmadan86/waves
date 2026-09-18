/**
 * Moving things around somebody's category list.
 *
 * The trap this file exists for: a built-in nobody has touched has **no
 * database row**. It is a position in a fixed list, not a record. So a reorder
 * can have to write rows for entries that were never stored, and a reorder that
 * wrote only the two swapped entries would leave every other entry carrying a
 * `sort_order` that no longer describes where it is.
 *
 * The assertions run against the real `buildCatalog`, so what is checked is the
 * order somebody actually sees — not a hand-written list that could drift from
 * it.
 */

import { describe, expect, it } from 'vitest';

import { buildCatalog, type CategoryTagRow } from '@waves/core';
import type { CategoryTagRecord } from '@waves/api-client';

import { catalogRows, moveEntry, setHidden } from '@/lib/catalog';

/** Ids are minted for built-ins that have never been stored. */
function minter() {
  let n = 0;
  return () => `minted-${++n}`;
}

function record(over: Partial<CategoryTagRecord> & Pick<CategoryTagRecord, 'id'>) {
  return {
    owner_user_id: 'me',
    builtin_id: null,
    label: null,
    icon: null,
    tint: null,
    sort_order: 0,
    hidden: false,
    ...over,
  } satisfies CategoryTagRecord;
}

const catalogOf = (rows: readonly CategoryTagRow[]) => buildCatalog(rows).all;

describe('catalogRows', () => {
  it('renames the columns and keeps every value', () => {
    const [row] = catalogRows([
      record({ id: 't1', label: 'Chai', icon: 'cup', tint: 'mint', sort_order: 3, hidden: true }),
    ]);
    expect(row).toEqual({
      id: 't1',
      builtinId: null,
      label: 'Chai',
      icon: 'cup',
      tint: 'mint',
      sortOrder: 3,
      hidden: true,
    });
  });
});

describe('moveEntry', () => {
  it('writes the whole list, including built-ins that had no row', () => {
    const all = catalogOf([]);
    const first = all[0]!.key;
    const second = all[1]!.key;

    const writes = moveEntry(all, second, -1, minter());

    // Every entry is written, because none of them had a row to begin with and
    // the ones that did could be carrying stale numbers.
    expect(writes).toHaveLength(all.length);
    // Renumbered from zero, in the new order.
    expect(writes.map((write) => write.sortOrder)).toEqual(all.map((_, index) => index));
    expect(writes[0]!.builtinId).toBe(second);
    expect(writes[1]!.builtinId).toBe(first);
    // Each untouched built-in still got an id minted for it.
    expect(writes.every((write) => write.id.length > 0)).toBe(true);
  });

  it('reuses an existing row’s id rather than minting a second one', () => {
    const rows = catalogRows([record({ id: 'food-row', builtin_id: 'food', sort_order: 0 })]);
    const all = catalogOf(rows);
    const writes = moveEntry(all, 'food', 1, minter());
    const food = writes.find((write) => write.builtinId === 'food');
    expect(food?.id).toBe('food-row');
  });

  it('never writes a label onto a built-in’s override row', () => {
    // The word lives in each client's string table. Writing English here would
    // freeze it for somebody reading in Tamil.
    const all = catalogOf([]);
    const writes = moveEntry(all, all[1]!.key, -1, minter());
    for (const write of writes) {
      if (write.builtinId) expect(write.label).toBeNull();
    }
  });

  it('keeps a custom tag’s own label, icon and colour through a move', () => {
    const rows = catalogRows([
      record({ id: 't1', label: 'Chai', icon: 'cup', tint: 'mint', sort_order: 99 }),
    ]);
    const all = catalogOf(rows);
    const writes = moveEntry(all, 't1', -1, minter());
    const chai = writes.find((write) => write.id === 't1');
    expect(chai).toMatchObject({ label: 'Chai', icon: 'cup', tint: 'mint', builtinId: null });
  });

  it('round-trips: writing a move back through buildCatalog gives that order', () => {
    // The contract that matters. If these disagree, the list jumps after a save.
    const all = catalogOf([]);
    const moved = all[3]!.key;
    const writes = moveEntry(all, moved, -1, minter());

    const after = catalogOf(
      writes.map((write) => ({
        id: write.id,
        builtinId: write.builtinId,
        label: write.label,
        icon: write.icon,
        tint: write.tint,
        sortOrder: write.sortOrder,
        hidden: write.hidden,
      })),
    );
    expect(after.map((entry) => entry.key)).toEqual(writes.map((write) => write.builtinId));
    expect(after[2]!.key).toBe(moved);
  });

  it('does nothing at either end, and nothing for a key that is not there', () => {
    const all = catalogOf([]);
    expect(moveEntry(all, all[0]!.key, -1, minter())).toEqual([]);
    expect(moveEntry(all, all[all.length - 1]!.key, 1, minter())).toEqual([]);
    expect(moveEntry(all, 'nothing-like-this', -1, minter())).toEqual([]);
  });
});

describe('setHidden', () => {
  it('writes one row, not the whole list — hiding moves nothing', () => {
    const all = catalogOf([]);
    const write = setHidden(all[2]!, true, minter());
    expect(write.hidden).toBe(true);
    expect(write.sortOrder).toBe(all[2]!.sortOrder);
    expect(write.builtinId).toBe(all[2]!.key);
  });

  it('un-hides through the same door', () => {
    const rows = catalogRows([record({ id: 'r', builtin_id: 'food', hidden: true })]);
    const hiddenEntry = catalogOf(rows).find((entry) => entry.key === 'food')!;
    expect(hiddenEntry.hidden).toBe(true);
    expect(setHidden(hiddenEntry, false, minter())).toMatchObject({ id: 'r', hidden: false });
  });
});
