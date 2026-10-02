/**
 * Two small, pure readings of one message that the detail screen draws
 * straight from, and that only earn their keep because they are testable
 * without a device:
 *
 *   * **The category quick-picks** — up to three round chips plus "More",
 *     guessed-category first so the one tap that is usually right is usually
 *     the first one offered.
 *   * **The transaction-type badge** — "Refund", "ATM withdrawal", "Card
 *     bill" where the classifier already knows one of those, else a plain
 *     "Debit"/"Credit" so an incoming payment never reads as a spend. Null
 *     where a badge would say nothing a reader does not already see — the
 *     amount's own colour and sign already say "money came in".
 */

import { CategoryId, SmsKind, SmsOtherReason } from '@waves/core';

import type { StoredSms } from './smsMessageTypes';

/** Offered before whatever the merchant's name happens to guess at, because
 *  they are the three a person reaches for most in the countries Waves ships
 *  in first — food, a shop, a ride. */
const DEFAULT_QUICK_CATEGORIES: readonly CategoryId[] = [
  CategoryId.Food,
  CategoryId.Shopping,
  CategoryId.Travel,
];

/**
 * Up to three category ids for the quick-pick row, guessed category first and
 * never repeated. The screen appends its own fourth chip ("More", into the
 * full catalog) — this never returns it, so a future category added to the
 * default three cannot silently crowd that chip out.
 */
export function quickCategoryPicks(guessed: CategoryId | string | null): CategoryId[] {
  const ordered = guessed
    ? [guessed as CategoryId, ...DEFAULT_QUICK_CATEGORIES]
    : DEFAULT_QUICK_CATEGORIES;
  const picks: CategoryId[] = [];
  for (const id of ordered) {
    if (!picks.includes(id)) picks.push(id);
    if (picks.length === 3) break;
  }
  return picks;
}

/** What the badge says, as an id the screen resolves to words in whichever
 *  language is showing — nothing here is English text. */
export type TransactionBadge = 'debit' | 'credit' | 'refund' | 'card-bill' | 'atm';

/**
 * The badge for this message, or null where one would only repeat what is
 * already on screen.
 *
 * A wallet top-up, an investment buy and a self-transfer already carry their
 * own, more specific chip (`reasonWords`, on every row in the third pile) —
 * this never duplicates that with a second, vaguer one. Refund, card bill and
 * cash withdrawal are the three classifications genuinely worth restating in
 * a badge of their own; everything else is the plain debit/credit the amount's
 * sign already carries, said once in words for the one person who cannot see
 * colour.
 */
export function transactionBadge(row: Pick<StoredSms, 'kind' | 'reason'>): TransactionBadge | null {
  if (row.reason === SmsOtherReason.Refund) return 'refund';
  if (row.reason === SmsOtherReason.CardBill) return 'card-bill';
  if (row.reason === SmsOtherReason.CashWithdrawal) return 'atm';
  if (row.reason !== null) return null;
  if (row.kind === SmsKind.Income) return 'credit';
  if (row.kind === SmsKind.Expense) return 'debit';
  return null;
}
