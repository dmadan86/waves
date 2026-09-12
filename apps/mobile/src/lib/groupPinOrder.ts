/**
 * Where a pin puts a group in a list that already knows how to sort itself.
 *
 * Both places Waves lists groups — the dashboard's preview and the All-groups
 * screen — already have their own ordering: debts first, settled below. A pin
 * does not replace that; it sits in front of it. "One effect and no others — a
 * pinned group sorts to the top and stays there" (see the `group_pins`
 * migration's header) means exactly this: take the list in the order it would
 * already have, then pull the pinned rows to the front, in the relative order
 * they already had among themselves. Nothing else about the list — which
 * groups count as settled, how the unpinned ones are ordered against each
 * other — moves.
 *
 * A stable partition, not a re-sort: `Array.prototype.sort` is free to reorder
 * elements its comparator calls equal, and a pin comparator ("pinned groups
 * compare before unpinned ones, equal otherwise") would leave both blocks in
 * whatever order the engine's sort felt like, which is not a promise any spec
 * makes. Partitioning by hand is the only way to guarantee both blocks keep
 * exactly today's order.
 *
 * Generic over the item type on purpose: the dashboard calls this on the plain
 * group rows before slicing to its preview count, and the All-groups screen
 * calls it on its already-decorated, already-sorted (active-then-settled) rows
 * before threading in the "Settled" divider. Both screens supply their own
 * "is this one pinned?" — usually `pinnedIds.has(item.id)` — so this file never
 * needs to know what a group looks like.
 */
export function orderByPin<T>(items: readonly T[], isPinned: (item: T) => boolean): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (isPinned(item) ? pinned : rest).push(item);
  }
  // No pins: return the input's own order untouched, rather than a rebuilt
  // copy — nothing moved, so nothing should even *look* like it might have.
  return pinned.length === 0 ? rest : [...pinned, ...rest];
}
