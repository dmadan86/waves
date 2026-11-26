import { parseMinorInput, type CurrencyCode } from '@waves/core';

/**
 * Typed money as minor units, or null when there is nothing readable in it.
 * Goes through the same parser as the phone, so "12,50" and "1,250.50" both work.
 */
export function parseAmountText(text: string, currency: CurrencyCode): bigint | null {
  const trimmed = text.trim();
  if (!/\d/.test(trimmed)) return null;
  return parseMinorInput(trimmed, currency);
}
