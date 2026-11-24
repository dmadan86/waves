/**
 * The pure parts of Home's "Needs you" card and Spaces grid: which few things
 * deserve the top of the screen today, and how many group tiles fit.
 */

import { formatParts, money, type CurrencyCode } from '@waves/core';

import { compactAmount } from '@/lib/householdHome';

export const NEEDS_LIMIT = 3;
/** A bill this many days away (or fewer) counts as "due soon". */
export const SOON_DAYS = 3;
export const SPACES_LIMIT = 5;

export interface BillNeed {
  readonly key: string;
  readonly source: 'personal' | 'group';
  readonly title: string;
  readonly amount: bigint;
  readonly currency: string;
  /** Days from today; negative once overdue. */
  readonly inDays: number;
  readonly date: string;
  readonly ruleId: string;
  readonly groupId?: string;
}

export interface PersonNeed {
  readonly key: string;
  readonly name: string;
  /** Always positive: how much, in the direction of its list. */
  readonly amount: bigint;
  readonly currency: string;
  readonly groupId: string | null;
  readonly memberId: string;
  readonly personKey: string;
  readonly avatarUrl?: string | null;
}

export type NeedKind = 'overdue' | 'soon' | 'owed' | 'owe' | 'review';
export type NeedAction = 'markPaid' | 'pay' | 'remind' | 'review';

export interface Need {
  readonly key: string;
  readonly kind: NeedKind;
  readonly action: NeedAction;
  readonly bill?: BillNeed;
  readonly person?: PersonNeed;
  /** Review only: how many captures wait. */
  readonly count?: number;
}

const byAmountDesc = (a: { amount: bigint; key: string }, b: { amount: bigint; key: string }) =>
  a.amount === b.amount ? (a.key < b.key ? -1 : 1) : a.amount > b.amount ? -1 : 1;

/**
 * Overdue bills, bills due within three days, money owed to you, money you owe,
 * then items to review — at most `limit` shown, with `total` counting all that qualify.
 */
export function rankNeeds(
  input: {
    bills: readonly BillNeed[];
    owedToYou: readonly PersonNeed[];
    youOwe: readonly PersonNeed[];
    reviewCount: number;
  },
  limit = NEEDS_LIMIT,
): { items: Need[]; total: number } {
  const byDay = (a: BillNeed, b: BillNeed) => a.inDays - b.inDays || (a.key < b.key ? -1 : 1);
  const bill =
    (kind: 'overdue' | 'soon') =>
    (b: BillNeed): Need => ({
      key: b.key,
      kind,
      action: b.source === 'personal' ? 'markPaid' : 'pay',
      bill: b,
    });
  const person =
    (kind: 'owed' | 'owe', action: NeedAction) =>
    (p: PersonNeed): Need => ({
      key: `${kind}:${p.key}`,
      kind,
      action,
      person: p,
    });
  const all: Need[] = [
    ...input.bills
      .filter((b) => b.inDays < 0)
      .sort(byDay)
      .map(bill('overdue')),
    ...input.bills
      .filter((b) => b.inDays >= 0 && b.inDays <= SOON_DAYS)
      .sort(byDay)
      .map(bill('soon')),
    ...input.owedToYou
      .filter((p) => p.amount > 0n)
      .sort(byAmountDesc)
      .map(person('owed', 'remind')),
    ...input.youOwe
      .filter((p) => p.amount > 0n)
      .sort(byAmountDesc)
      .map(person('owe', 'pay')),
    ...(input.reviewCount > 0
      ? [{ key: 'review', kind: 'review', action: 'review', count: input.reviewCount } as Need]
      : []),
  ];
  return { items: all.slice(0, limit), total: all.length };
}

/** Needs-you key for a personal bill row; Coming up's row key is this minus the prefix. */
export const personalNeedKey = (rowKey: string): string => `p:${rowKey}`;

/** The personal bill row keys shown in Needs you, '|'-joined, for Coming up to leave out. */
export const shownPersonalKeys = (items: readonly Need[]): string =>
  items
    .filter((need) => need.bill?.source === 'personal')
    .map((need) => need.bill!.key.slice(2))
    .join('|');

/** False when a Coming up row is already in Needs you (`exclude` is '|'-joined keys). */
export const notExcluded = (rowKey: string, exclude: string): boolean =>
  !(exclude && exclude.split('|').includes(rowKey));

/** An auto-post rule's missed day is posted by the catch-up, not by hand. */
export const isAutoPostOverdue = (
  row: { inDays: number; ruleId?: string },
  ruleById: ReadonlyMap<string, { autoPost?: boolean }>,
): boolean => row.inDays < 0 && !!ruleById.get(row.ruleId ?? '')?.autoPost;

/** The first `max` tiles, and whether a "See all" tile is needed for the rest. */
export function capSpaces<T>(
  items: readonly T[],
  max = SPACES_LIMIT,
): { shown: T[]; more: boolean } {
  return items.length > max
    ? { shown: items.slice(0, max), more: true }
    : { shown: [...items], more: false };
}

/** An amount with a bare ".00" dropped; real minor units still show. */
export function plainAmount(amount: bigint, currency: string, locale: string): string {
  return compactAmount(formatParts(money(amount, currency as CurrencyCode), { locale }));
}
