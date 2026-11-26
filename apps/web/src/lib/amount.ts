import { isAmountWithinLimit, parseMinorInput, type CurrencyCode } from '@waves/core';

/**
 * Typed money as minor units, or null when there is nothing readable in it.
 * Goes through the same parser as the phone, so "12,50" and "1,250.50" both work.
 *
 * The shared parser drops anything it does not understand, which is right for a
 * keystroke and wrong for a pasted "-5" or "1e3" (they would save 5.00 and 13.00),
 * so a sign or an exponent is refused here, as is a figure past the app's limit.
 */
export function parseAmountText(text: string, currency: CurrencyCode): bigint | null {
  const trimmed = text.trim();
  if (!/\d/.test(trimmed) || /[-+−–]|[eE]/.test(trimmed)) return null;
  const minor = parseMinorInput(trimmed, currency);
  return isAmountWithinLimit(minor) ? minor : null;
}
