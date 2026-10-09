/**
 * Presentation rules for a group that settles in its own currency (ADR-003
 * amendment). The arithmetic is core's (`toSettleExpense`); this only decides
 * what a screen says about it.
 */

import { currencySymbol, type CurrencyCode } from '@waves/core';

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
