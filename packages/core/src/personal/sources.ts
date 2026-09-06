/**
 * Where money came from.
 *
 * The expense side of the ledger has `CATEGORIES` (category/categories.ts) —
 * ten things money is spent on. Income had nothing, so a salary and a month's
 * rent both filed under a spend category, usually "Other", and the question the
 * ledger most wants to answer — *which of my incomes is this?* — had no field to
 * answer it with.
 *
 * These are deliberately **general**. The expense keyword table is openly Indian
 * (see the note atop categories.ts) because guessing a category from "auto" or
 * "Swiggy" only works if you know the market. A source is chosen, never guessed,
 * so there is nothing to localise in the same way — and an app used anywhere
 * should not ship a picker naming one country's instruments. A PF withdrawal, a
 * fixed-deposit payout, an ISA, a 401(k) distribution: each is an "Interest" or
 * a "Pension" here, and anybody who wants the exact local word can make their
 * own source and call it that.
 *
 * Fifteen, not fifty, for the same reason the spend list stops at ten: a picker
 * you scroll past is a picker nobody uses. "Other income" is a real answer.
 */

/** A source is stored in the same string column an expense category is, so the
 *  ids are prefixed to keep the two vocabularies from ever colliding — a ledger
 *  where `other` could mean two different things is a ledger that miscounts. */
export enum IncomeSourceId {
  Salary = 'inc.salary',
  Business = 'inc.business',
  Freelance = 'inc.freelance',
  Rent = 'inc.rent',
  Interest = 'inc.interest',
  Dividends = 'inc.dividends',
  Investment = 'inc.investment',
  Pension = 'inc.pension',
  Bonus = 'inc.bonus',
  Commission = 'inc.commission',
  Royalties = 'inc.royalties',
  Refund = 'inc.refund',
  Gift = 'inc.gift',
  Benefit = 'inc.benefit',
  Other = 'inc.other',
}

export interface IncomeSource {
  readonly id: IncomeSourceId;
  /** English. The app translates through its own string table (TDR §11). */
  readonly label: string;
  /** An Ionicons name. A string here keeps this package free of React. */
  readonly icon: string;
  /** Which pastel from the design system's tint family this draws in. */
  readonly tint: 'lilac' | 'pink' | 'mint' | 'peach' | 'sky' | 'coral';
}

export const INCOME_SOURCES: readonly IncomeSource[] = [
  { id: IncomeSourceId.Salary, label: 'Salary', icon: 'briefcase-outline', tint: 'sky' },
  { id: IncomeSourceId.Business, label: 'Business', icon: 'storefront-outline', tint: 'mint' },
  { id: IncomeSourceId.Freelance, label: 'Freelance', icon: 'laptop-outline', tint: 'lilac' },
  { id: IncomeSourceId.Rent, label: 'Rent received', icon: 'home-outline', tint: 'peach' },
  { id: IncomeSourceId.Interest, label: 'Interest', icon: 'trending-up-outline', tint: 'mint' },
  { id: IncomeSourceId.Dividends, label: 'Dividends', icon: 'pie-chart-outline', tint: 'sky' },
  {
    id: IncomeSourceId.Investment,
    label: 'Investment sale',
    icon: 'stats-chart-outline',
    tint: 'lilac',
  },
  { id: IncomeSourceId.Pension, label: 'Pension', icon: 'shield-checkmark-outline', tint: 'mint' },
  { id: IncomeSourceId.Bonus, label: 'Bonus', icon: 'sparkles-outline', tint: 'coral' },
  { id: IncomeSourceId.Commission, label: 'Commission', icon: 'pricetag-outline', tint: 'peach' },
  { id: IncomeSourceId.Royalties, label: 'Royalties', icon: 'musical-notes-outline', tint: 'pink' },
  {
    id: IncomeSourceId.Refund,
    label: 'Refund',
    icon: 'arrow-undo-outline',
    tint: 'sky',
  },
  { id: IncomeSourceId.Gift, label: 'Gift', icon: 'gift-outline', tint: 'pink' },
  { id: IncomeSourceId.Benefit, label: 'Benefit', icon: 'ribbon-outline', tint: 'mint' },
  { id: IncomeSourceId.Other, label: 'Other income', icon: 'ellipsis-horizontal', tint: 'lilac' },
];

const BY_ID = new Map<string, IncomeSource>(INCOME_SOURCES.map((source) => [source.id, source]));

/** The source for a stored value, or null when it is a custom one (or absent).
 *  Null is an ordinary answer here: the caller falls back to the stored string,
 *  which for a user-made source is the name they typed. */
export function incomeSource(id: string | null): IncomeSource | null {
  return id === null ? null : (BY_ID.get(id) ?? null);
}

/** Whether a stored category value names one of the built-in income sources.
 *  Used to decide which picker an entry belongs in, and to keep spend charts
 *  from counting an income source as a spending category. */
export function isIncomeSourceId(id: string | null): boolean {
  return id !== null && BY_ID.has(id);
}
