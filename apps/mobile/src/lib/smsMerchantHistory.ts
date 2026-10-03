/**
 * "Seen before" and "looks recurring" — read straight off the messages
 * already on this device, with nothing new stored for it.
 *
 * The detail screen opens on one message; this answers the question a person
 * actually has standing there, which is "have I paid this one before, and
 * does it keep happening?" `lib/smsMessageStore.ts` already keeps every
 * message this phone has read, so the answer is a pass over what is already
 * loaded (`useSmsMessages`) rather than a new query or a new column.
 *
 * Pure, and deliberately unaware of currency conversion: a total is only
 * offered when every earlier message counted was in the *same* currency as
 * the one on screen, exactly the rule `lib/smsInbox.ts#sumOf` already uses for
 * the same reason (ADR-004 — balances, and now this, never sum across
 * currencies).
 */

import type { StoredSms } from './smsMessageTypes';

export interface SeenBefore {
  /** Earlier messages to the same merchant — not counting this one. */
  readonly count: number;
  /** The sum of the earlier ones that were in this message's own currency, or
   *  null when none of them were (a different currency every time, or an
   *  amount the parser could not read). */
  readonly total: bigint | null;
  readonly currency: string;
  /** The earlier payments, plus this one, land roughly a month apart. */
  readonly recurring: boolean;
}

function sameMerchant(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether a run of (sorted) `YYYY-MM-DD` dates lands roughly a month apart —
 * every gap between 21 and 40 days, which covers a bill that moves around the
 * date a weekend or a bank holiday falls on without also matching a pair of
 * payments made in the same week.
 *
 * Needs three dates, not two: two payments thirty days apart is as likely to
 * be a coincidence as a pattern, and calling it "recurring" on that little
 * evidence is the kind of guess that makes the chip something people stop
 * trusting.
 */
export function looksMonthly(sortedIsoDates: readonly string[]): boolean {
  if (sortedIsoDates.length < 3) return false;
  let previous: number | null = null;
  for (const iso of sortedIsoDates) {
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return false;
    if (previous !== null) {
      const gapDays = (parsed - previous) / 86_400_000;
      if (gapDays < 21 || gapDays > 40) return false;
    }
    previous = parsed;
  }
  return true;
}

/**
 * The earlier history for one message's merchant, or null when this is the
 * only message this phone has from them — the line under the summary card has
 * nothing to say in that case, and says nothing rather than "0 earlier
 * payments".
 */
export function seenBefore(rows: readonly StoredSms[], row: StoredSms): SeenBefore | null {
  if (!row.merchant) return null;
  const earlier = rows.filter(
    (other) => other.dedupeKey !== row.dedupeKey && sameMerchant(other.merchant, row.merchant),
  );
  if (earlier.length === 0) return null;

  let total = 0n;
  let counted = 0;
  for (const other of earlier) {
    if (other.currency !== row.currency) continue;
    if (!/^-?\d+$/.test(other.amount.trim())) continue;
    total += BigInt(other.amount.trim());
    counted += 1;
  }

  const allDates = [...earlier.map((other) => other.occurredOn), row.occurredOn].sort();

  return {
    count: earlier.length,
    total: counted > 0 ? total : null,
    currency: row.currency,
    recurring: looksMonthly(allDates),
  };
}
