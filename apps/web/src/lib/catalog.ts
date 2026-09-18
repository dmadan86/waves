/**
 * The category manager's two pieces of arithmetic.
 *
 * `buildCatalog` in `@waves/core` decides what the list contains and in what
 * order — the ten built-ins merged with this person's overrides, plus their own
 * tags. What is here is the part the browser owns: turning database rows into
 * the shape core reads, and working out what a move up or down actually writes.
 *
 * The move is the subtle one. The list is ordered by `sort_order`, but a
 * built-in that nobody has touched has **no row at all** — it is a position in
 * a fixed list, not a record. So moving anything can mean writing rows for
 * entries that were never stored, and a move that only wrote the two swapped
 * entries would leave the rest of the list with sort orders that no longer
 * describe it. Renumbering the whole list from zero is what keeps the order
 * somebody sees and the order the database holds the same thing.
 */

import type { CatalogEntry, CategoryTagRow } from '@waves/core';
import type { CategoryTagRecord } from '@waves/api-client';

/** Database rows in the shape `buildCatalog` reads. */
export function catalogRows(records: readonly CategoryTagRecord[]): CategoryTagRow[] {
  return records.map((row) => ({
    id: row.id,
    builtinId: row.builtin_id,
    label: row.label,
    icon: row.icon,
    tint: row.tint,
    sortOrder: row.sort_order,
    hidden: row.hidden,
  }));
}

/** One row to write: an existing row changed, or a built-in's first override. */
export interface CatalogWrite {
  readonly id: string;
  readonly builtinId: string | null;
  readonly label: string | null;
  readonly icon: string | null;
  readonly tint: string | null;
  readonly sortOrder: number;
  readonly hidden: boolean;
}

/**
 * What to write for an entry, given the row backing it — minting an id when
 * there is none, because a built-in gains its override row the first time
 * somebody moves or hides it.
 */
function writeFor(entry: CatalogEntry, sortOrder: number, mintId: () => string): CatalogWrite {
  return {
    id: entry.tagId ?? mintId(),
    builtinId: entry.builtinId,
    // A built-in's override carries no label: the word stays in each client's
    // own string table, so somebody reading in Tamil keeps reading in Tamil.
    // Writing the English here would freeze it for them.
    label: entry.custom ? entry.label : null,
    icon: entry.custom ? entry.icon : null,
    tint: entry.custom ? entry.tint : null,
    sortOrder,
    hidden: entry.hidden,
  };
}

/**
 * Move one entry one place, and say what that means for the whole list.
 *
 * Returns the rows to write, renumbered from zero. Every entry is written, not
 * just the two that swapped: the untouched ones may have had no row, or a
 * `sort_order` inherited from a list that has since changed shape, and either
 * way the numbers have to describe the list somebody is now looking at.
 *
 * A move off either end is not an error and not a no-op to guard against — it
 * simply returns the list unchanged, because the entry is already where it was
 * asked to go.
 */
export function moveEntry(
  all: readonly CatalogEntry[],
  key: string,
  direction: -1 | 1,
  mintId: () => string,
): CatalogWrite[] {
  const from = all.findIndex((entry) => entry.key === key);
  if (from < 0) return [];
  const to = from + direction;
  if (to < 0 || to >= all.length) return [];

  const order = [...all];
  const [moved] = order.splice(from, 1);
  if (!moved) return [];
  order.splice(to, 0, moved);

  return order.map((entry, index) => writeFor(entry, index, mintId));
}

/**
 * Hide or show one entry.
 *
 * Only the entry itself is written — hiding changes no positions, and
 * renumbering the list for it would turn one tap into ten rows.
 */
export function setHidden(
  entry: CatalogEntry,
  hidden: boolean,
  mintId: () => string,
): CatalogWrite {
  return { ...writeFor(entry, entry.sortOrder, mintId), hidden };
}
