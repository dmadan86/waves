/**
 * The pure half of the Groups list: which rows a filter chip and a search keep,
 * and what order they come in. Kept out of the screen so the rules — who counts
 * as "owed" and where settled groups fall — can be tested
 * without a renderer.
 */

export type GroupsFilter = 'all' | 'owed' | 'owe';
export type GroupsSort = 'amount' | 'recent' | 'name';

/** Latest activity first; the screen keeps no saved sort, so this is every visit's start. */
export const DEFAULT_GROUPS_SORT: GroupsSort = 'recent';

/** What the list needs to know about one group; the screen fills it in. */
export interface GroupsEntry {
  readonly id: string;
  readonly label: string;
  /** Signed minor units: positive is owed to you, negative is what you owe. */
  readonly balance: bigint;
  /** A balance or a pending confirmation — the group still wants something. */
  readonly needsAction: boolean;
  /** When the group's ledger last moved, in ms. */
  readonly lastActive: number;
}

const absBig = (n: bigint): bigint => (n < 0n ? -n : n);

/** Keeps the rows a chip and a name search both let through. */
export function filterGroups<T extends GroupsEntry>(
  entries: readonly T[],
  filter: GroupsFilter,
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (needle && !entry.label.toLowerCase().includes(needle)) return false;
    switch (filter) {
      case 'owed':
        return entry.balance > 0n;
      case 'owe':
        return entry.balance < 0n;
      default:
        return true;
    }
  });
}

/**
 * Orders the rows. `amount` is the screen's
 * original money-first order — groups wanting action, biggest balance first,
 * then the settled ones; `recent` is newest ledger activity first; `name` is
 * alphabetical in the reader's locale. Every sort is stable on ties.
 */
export function sortGroups<T extends GroupsEntry>(
  entries: readonly T[],
  sort: GroupsSort,
  locale?: string,
): T[] {
  const byBalance = (a: T, b: T): number => {
    const x = absBig(a.balance);
    const y = absBig(b.balance);
    return x === y ? 0 : y > x ? 1 : -1;
  };
  if (sort === 'name') {
    return [...entries].sort((a, b) => a.label.localeCompare(b.label, locale));
  }
  if (sort === 'recent') {
    return [...entries].sort((a, b) => b.lastActive - a.lastActive);
  }
  const active = entries.filter((e) => e.needsAction).sort(byBalance);
  return [...active, ...entries.filter((e) => !e.needsAction)];
}
