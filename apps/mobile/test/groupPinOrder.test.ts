/**
 * `orderByPin`'s whole job is "pinned first, existing order otherwise" — so
 * these tests are mostly about proving the *otherwise* half: that pinning one
 * group never reshuffles anybody else, that unpinning is a plain return to
 * where a group already was (there is no separate "restore" step — the
 * ordering is recomputed from the pin set every time), and that a dashboard
 * slicing the result to a handful of rows sees the pinned ones regardless of
 * where they sat before.
 */

import { describe, expect, it } from 'vitest';

import { orderByPin } from '../src/lib/groupPinOrder';

interface Group {
  id: string;
}

const g = (id: string): Group => ({ id });

describe('orderByPin', () => {
  it('returns the input order untouched when nothing is pinned', () => {
    const items = [g('a'), g('b'), g('c')];
    expect(orderByPin(items, () => false)).toEqual(items);
  });

  it('moves pinned groups to the front, preserving order inside each block', () => {
    const items = [g('a'), g('b'), g('c'), g('d')];
    const pinned = new Set(['c', 'a']);
    const ordered = orderByPin(items, (item) => pinned.has(item.id));
    // 'a' and 'c' pinned, in the order they already had (a before c); then 'b'
    // and 'd', likewise in their original order.
    expect(ordered.map((item) => item.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('pinning everything is a no-op — one block, original order', () => {
    const items = [g('a'), g('b'), g('c')];
    expect(orderByPin(items, () => true).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('unpinning restores exactly the order the list would otherwise have', () => {
    const items = [g('a'), g('b'), g('c')];
    const pinnedOnce = orderByPin(items, (item) => item.id === 'b');
    expect(pinnedOnce.map((item) => item.id)).toEqual(['b', 'a', 'c']);

    // Unpinning is not undone by any state this module owns — the caller's pin
    // set simply no longer marks 'b', and recomputing from the *original* list
    // (not from `pinnedOnce`) puts every group back exactly where it started.
    const afterUnpin = orderByPin(items, () => false);
    expect(afterUnpin.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });

  it("a truncated list — the dashboard's preview — picks pinned groups first", () => {
    // Five groups; the dashboard would normally show the first three. 'e' is
    // pinned but sorts last in the underlying order, and pinning it is the
    // whole point of the feature: it must still make the cut.
    const items = [g('a'), g('b'), g('c'), g('d'), g('e')];
    const ordered = orderByPin(items, (item) => item.id === 'e');
    const preview = ordered.slice(0, 3);
    expect(preview.map((item) => item.id)).toEqual(['e', 'a', 'b']);
  });

  it('a refused pin (never reflected in the pin set) leaves the list exactly as it was', () => {
    // Standing in for the offline-refusal case at the ordering layer: a pin
    // that never took (the mutation was discarded) means `isPinned` simply
    // never returns true for that group, which this function treats no
    // differently from a group that was never pinned at all.
    const items = [g('a'), g('b')];
    expect(orderByPin(items, () => false)).toEqual(items);
  });
});
