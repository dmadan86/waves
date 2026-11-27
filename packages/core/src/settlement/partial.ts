/**
 * Part payments. A partial payment is an ordinary settlement of a smaller
 * amount; these are the two questions the screens ask about it.
 */

import { format, money, type CurrencyCode } from '../money/index';
import { copyFor, interpolate } from '../notifications/copy';

export enum PartialCheck {
  Ok = 'ok',
  /** Nothing typed, or zero. */
  Empty = 'empty',
  /** More than is owed: the plan never records an overpayment. */
  Over = 'over',
}

/** Is `entered` an amount that can be recorded against `owed`? */
export function checkPartialAmount(entered: bigint, owed: bigint): PartialCheck {
  if (entered <= 0n) return PartialCheck.Empty;
  return entered > owed ? PartialCheck.Over : PartialCheck.Ok;
}

/** What is still owed after paying `paid` of `owed`; 0n when it was paid in full. */
export function remainderAfter(owed: bigint, paid: bigint): bigint {
  return paid >= owed ? 0n : owed - paid;
}

/**
 * Read a settled activity payload: `amount` (number or string) and, for a part
 * payment, `owed` (what was owed before it). Null for a payment in full.
 */
export function partPaymentOf(
  payload: Readonly<Record<string, unknown>> | null | undefined,
): { amount: bigint; owed: bigint; currency: string } | null {
  if (!payload) return null;
  const big = (value: unknown): bigint | null => {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
    return typeof value === 'string' && /^\d+$/.test(value.trim()) ? BigInt(value.trim()) : null;
  };
  const amount = big(payload.amount);
  const owed = big(payload.owed);
  const currency = payload.currency;
  if (amount === null || owed === null || typeof currency !== 'string' || owed <= amount)
    return null;
  return { amount, owed, currency };
}

/** "₹2,000 of ₹5,000" for a part payment's activity row; null for a payment in full. */
export function partPaymentText(
  payload: Readonly<Record<string, unknown>> | null | undefined,
  locale: string,
): string | null {
  const part = partPaymentOf(payload);
  if (!part) return null;
  try {
    const code = part.currency as CurrencyCode;
    return interpolate(copyFor(locale).partialOf, {
      amount: format(money(part.amount, code), { locale }),
      owed: format(money(part.owed, code), { locale }),
    });
  } catch {
    return null;
  }
}
