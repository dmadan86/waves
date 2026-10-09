/**
 * A group settles in its own currency (ADR-003 amendment).
 *
 * A bill paid in a foreign currency, with a rate stored on its version, counts
 * toward balances in the group's currency at THAT rate — never today's. The
 * converted total is `convert(amount, fx)`, rounded once; payers and shares are
 * then apportioned over it by largest remainder, so every bill still sums to
 * zero in the currency it settles in (ADR-004). A bill without a usable rate is
 * left exactly as it was, in its own currency.
 *
 * Postgres does the same arithmetic in `waves_group_expense_lines`
 * (20261009120000_settle_in_group_currency). The two are held to identical
 * output by the parity tests in packages/db, so every rule below is written to
 * be expressible in SQL: integer division only, no floating point, ties broken
 * by member id in byte order.
 */

import { isCurrencyCode, type CurrencyCode } from '../money/currency';
import { minorUnitRate } from '../money/fx';
import { divideRoundHalfAwayFromZero } from '../money/money';
import type { MemberId } from '../split/types';
import type { ExpenseSnapshot } from './types';

/** A stored rate that passed `usableFx`, parsed to exact integers. */
export interface UsableFx {
  readonly num: bigint;
  readonly den: bigint;
  readonly to: CurrencyCode;
}

const DIGITS = /^[0-9]+$/;

function digits(value: unknown): bigint | null {
  if (typeof value !== 'string' || !DIGITS.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}

/**
 * Whether a version's stored `fx` can convert it into the group's currency, and
 * the rate if so.
 *
 * The exact twin of SQL `waves_fx_usable`: an object whose `from` is the bill's
 * currency, whose `to` is the GROUP's currency (and differs from the bill's),
 * and whose `num`/`den` are positive integers written as strings (how
 * `toFxRecord` stores them). Anything else — null, a number-typed numerator, a
 * rate in the wrong direction, a rate into some third currency — is "no rate",
 * and the bill stays in its own currency on both sides. A rate into another
 * currency is never used, so a converting group never grows a third bucket.
 */
export function usableFx(fx: unknown, currency: string, groupCurrency: string): UsableFx | null {
  if (fx === null || typeof fx !== 'object' || Array.isArray(fx)) return null;
  if (!isCurrencyCode(currency) || !isCurrencyCode(groupCurrency)) return null;
  if (currency === groupCurrency) return null;
  const record = fx as Record<string, unknown>;
  if (typeof record.from !== 'string' || record.from !== currency) return null;
  if (typeof record.to !== 'string' || record.to !== groupCurrency) return null;
  const num = digits(record.num);
  const den = digits(record.den);
  if (num === null || den === null) return null;
  return { num, den, to: groupCurrency };
}

/** ⌊a / b⌋ for b > 0, rounding toward −∞ (bigint `/` truncates toward 0). */
function floorDiv(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && a < 0n ? quotient - 1n : quotient;
}

/** Byte order on the id, the same order `stableOrder` and Postgres's uuid use. */
function byId(a: MemberId, b: MemberId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Hand `total` out across `weights` in proportion to `weight × num / den`.
 *
 * Largest remainder: each member gets the floor of their exact quota, then the
 * units still missing from `total` go one each to the largest fractional
 * remainders, ties to the smaller member id. When Σ weights × num / den rounds
 * to `total` (which is how the caller picks it), the leftover is between 0 and
 * the number of members, so nobody is ever more than one minor unit from their
 * exact quota and the result sums to `total` exactly.
 *
 * Deliberately not `distributeProportionally`: its FNV rotation has no SQL twin,
 * and this must give Postgres's answer to the paisa.
 */
export function apportion(
  weights: Readonly<Record<MemberId, bigint>>,
  num: bigint,
  den: bigint,
  total: bigint,
): Record<MemberId, bigint> {
  const rows = Object.entries(weights).map(([member, weight]) => {
    const exact = weight * num;
    const floor = floorDiv(exact, den);
    return { member, floor, remainder: exact - floor * den };
  });

  let allocated = 0n;
  for (const row of rows) allocated += row.floor;
  const leftover = total - allocated;

  rows.sort((a, b) =>
    a.remainder !== b.remainder ? (a.remainder > b.remainder ? -1 : 1) : byId(a.member, b.member),
  );

  const out: Record<MemberId, bigint> = {};
  rows.forEach((row, index) => {
    out[row.member] = row.floor + (BigInt(index) < leftover ? 1n : 0n);
  });
  return out;
}

/**
 * The bill as it counts toward balances in a group that settles in its own
 * currency: converted at its stored rate, or returned untouched when it has no
 * usable one (or is already in that currency).
 *
 * The original amount and rate are not lost — `convertedFrom` keeps what was
 * paid, and nothing is written back. Balances move only when a bill or a
 * settlement is edited, never because a rate moved somewhere else.
 */
export function toSettleExpense(snapshot: ExpenseSnapshot, groupCurrency: string): ExpenseSnapshot {
  const fx = usableFx(snapshot.fx, snapshot.currency, groupCurrency);
  if (!fx) return snapshot;

  // convert(amount, fx): the exact rational, rounded half away from zero once,
  // over the same scaled n/d the payers and shares are apportioned with below.
  const { num, den } = minorUnitRate({
    num: fx.num,
    den: fx.den,
    from: snapshot.currency,
    to: fx.to,
  });
  const total = divideRoundHalfAwayFromZero(snapshot.amount * num, den);

  return {
    ...snapshot,
    currency: fx.to,
    amount: total,
    payers: apportion(snapshot.payers, num, den, total),
    shares: apportion(snapshot.shares, num, den, total),
    fx: null,
    convertedFrom: { currency: snapshot.currency, amount: snapshot.amount },
  };
}

/**
 * Every snapshot of a group's ledger, as balances should count it. A group that
 * has not opted in passes null and keeps each bill in its own currency, exactly
 * as before; one that has passes its `default_currency`.
 */
export function toSettleExpenses(
  snapshots: readonly ExpenseSnapshot[],
  groupCurrency: string | null,
): ExpenseSnapshot[] {
  return groupCurrency
    ? snapshots.map((snapshot) => toSettleExpense(snapshot, groupCurrency))
    : [...snapshots];
}

/** The two group columns that decide how its bills count. */
export interface LedgerGroup {
  readonly default_currency?: string | null;
  readonly convert_to_group_currency?: boolean | null;
}

/**
 * THE rule for turning a group's bills into what its balances count. Every
 * reader (the app's ledger, home, people, the offline mirror, the web's
 * `computeLedger`) goes through this, so it lives in one place: drop rows that
 * could not be read, and convert into `default_currency` only when the group
 * has opted in.
 */
export function toLedgerSnapshots(
  snapshots: readonly (ExpenseSnapshot | null)[],
  group: LedgerGroup | null | undefined,
): ExpenseSnapshot[] {
  const readable = snapshots.filter((snapshot): snapshot is ExpenseSnapshot => snapshot !== null);
  const groupCurrency =
    group?.convert_to_group_currency === true && group.default_currency
      ? group.default_currency.trim()
      : null;
  return toSettleExpenses(readable, groupCurrency);
}

/**
 * The currencies of live bills that were converted into another one — what the
 * balance hero names in "includes ₫ bills at their recorded rates".
 */
export function convertedCurrencies(snapshots: readonly ExpenseSnapshot[]): CurrencyCode[] {
  const seen = new Set<CurrencyCode>();
  for (const snapshot of snapshots) {
    if (snapshot.deletedAt) continue;
    if (snapshot.convertedFrom) seen.add(snapshot.convertedFrom.currency);
  }
  return [...seen].sort();
}
