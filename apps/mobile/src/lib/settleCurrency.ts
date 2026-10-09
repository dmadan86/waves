/**
 * Presentation rules for a group that settles in its own currency (ADR-003
 * amendment). The arithmetic is core's (`toSettleExpense`); this only decides
 * what a screen says about it.
 */

import { currencySymbol, type CurrencyCode } from '@waves/core';

import type { ExpenseRow } from '../data/types';
import { canRewrite, needsRate, selectBackfill } from './fxAutoRate';

/**
 * A transfer in a converting group that is NOT in the group's currency comes
 * from a bill with no rate yet. It cannot be paid — the server takes only the
 * group currency there (UPDATE_APP_TO_SETTLE) — so the screen offers "add rate"
 * instead. In a group that has not opted in, every currency is payable.
 */
export function isRatelessTransfer(
  transfer: { readonly currency: string },
  groupCurrency: string,
  convertsToGroupCurrency: boolean,
): boolean {
  return convertsToGroupCurrency && transfer.currency !== groupCurrency;
}

/**
 * Where "Add rate" on a rate-less debt should take this person.
 *
 * - `backfill`: at least one of the bills behind it is theirs to give a rate
 *   (author or payer, a split the editor round-trips) — the group's "Add
 *   missing rates" card does it in one go, stamping each bill's own rate.
 * - `openBill`: theirs, but a split the backfill will not rewrite; open it.
 * - `notYours`: none of them is theirs to rewrite. Say whose it is, and offer
 *   to open it (the author, or whoever paid, can add the rate).
 * - `settings`: nothing found locally (still syncing); the settings screen
 *   carries the same card and the rates.
 *
 * Bills both people are on come first, so the one opened is one this debt is
 * actually about.
 */
export type RateFix =
  | { readonly kind: 'backfill' }
  | { readonly kind: 'openBill'; readonly expenseId: string }
  | { readonly kind: 'notYours'; readonly expenseId: string; readonly authorId: string | null }
  | { readonly kind: 'settings' };

export function rateFixFor(input: {
  readonly rows: readonly ExpenseRow[];
  /** The rate-less debt's currency (a bill currency, not the group's). */
  readonly currency: string;
  readonly groupCurrency: string;
  /** The viewer's active member id, or null if they have left. */
  readonly myMemberId: string | null;
  /** The two ends of the debt. */
  readonly parties: readonly string[];
}): RateFix {
  const { rows, currency, groupCurrency, myMemberId, parties } = input;
  const missing = rows.filter((row) => {
    const version = row.currentVersion;
    return (
      !row.deleted_at &&
      version !== null &&
      version !== undefined &&
      version.currency === currency &&
      needsRate({ currency: version.currency, groupCurrency, fx: version.fx })
    );
  });
  if (missing.length === 0) return { kind: 'settings' };

  const onIt = (row: ExpenseRow): boolean =>
    parties.every(
      (member) =>
        (row.currentVersion?.payers ?? []).some((payer) => payer.member_id === member) ||
        (row.currentVersion?.shares ?? []).some((share) => share.member_id === member),
    );
  const ordered = [...missing.filter(onIt), ...missing.filter((row) => !onIt(row))];

  if (selectBackfill(ordered, groupCurrency, myMemberId).length > 0) return { kind: 'backfill' };

  const mine = ordered.find((row) => canRewrite(row.currentVersion, myMemberId));
  if (mine) return { kind: 'openBill', expenseId: mine.id };
  const first = ordered[0] as ExpenseRow;
  return {
    kind: 'notYours',
    expenseId: first.id,
    authorId: first.currentVersion?.author_member_id ?? null,
  };
}

/** Why the "Settle in {currency}" switch cannot move right now. */
export type ConvertBlock =
  | { readonly kind: 'adminOnly' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'missingRates'; readonly currency: string; readonly count: number }
  | { readonly kind: 'foreignSettlements'; readonly currency: string };

/**
 * The switch's state, by the server's own rules (`waves_set_group_convert`):
 * admin-only; on needs every foreign bill rated and no settlement in another
 * currency; off is refused once any settlement exists. Shown so the switch is
 * never offered in a state the server will refuse.
 */
export function convertSwitchBlocks(input: {
  readonly on: boolean;
  readonly isAdmin: boolean;
  readonly readiness: readonly {
    readonly currency: string;
    readonly missing_rates: number;
    readonly foreign_settlements: number;
  }[];
  /** Settlements in the group that are not cancelled. */
  readonly settlementCount: number;
}): ConvertBlock[] {
  if (input.on) {
    if (input.settlementCount > 0) return [{ kind: 'locked' }];
    return input.isAdmin ? [] : [{ kind: 'adminOnly' }];
  }
  const blocks: ConvertBlock[] = [];
  for (const row of input.readiness) {
    if (row.missing_rates > 0) {
      blocks.push({ kind: 'missingRates', currency: row.currency, count: row.missing_rates });
    }
    if (row.foreign_settlements > 0) {
      blocks.push({ kind: 'foreignSettlements', currency: row.currency });
    }
  }
  if (!input.isAdmin) blocks.unshift({ kind: 'adminOnly' });
  return blocks;
}

/**
 * "Includes ₫ bills at their recorded rates" — or null when nothing was
 * converted, so the caption only appears when it explains something.
 */
export function convertedCaption(
  currencies: readonly string[],
  locale: string,
  template: string,
): string | null {
  if (currencies.length === 0) return null;
  const symbols = currencies.map((code) => {
    try {
      return currencySymbol(code as CurrencyCode, locale);
    } catch {
      return code;
    }
  });
  // A plain replace rather than i18n's `fill`, so this stays a pure module.
  return template.replace('{currencies}', symbols.join(' '));
}
