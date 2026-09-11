/**
 * What the Friends screen says about money, as arithmetic rather than layout.
 *
 * Three questions the screen asks and a component is a poor place to answer:
 * what you stand at in each currency, how those fold into the two things the
 * hero actually says, and which way a single person's balance runs. All three
 * are pure, all three have edge cases worth pinning, and none of them needs a
 * renderer to be true — so they live here and `friends.tsx` draws the answers.
 */

/** The net in one currency. Positive: owed to you. */
export interface CurrencyTotal {
  currency: string;
  net: bigint;
}

/** Anything with a signed net in a currency — a person's row, or a total. */
interface NetRow {
  currency: string;
  net: string | bigint;
}

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * The net you are up or down in each currency, summed over everyone.
 *
 * Never summed *across* currencies (ADR-003): there is no such thing as a total
 * in no currency, and inventing one would need a rate this screen does not have.
 * Biggest first, so whatever leads the hero is the figure that matters most.
 * Currencies that net to zero drop out — "you are owed ₹0" is not news.
 */
export function currencyTotals(rows: readonly NetRow[]): CurrencyTotal[] {
  const sums = new Map<string, bigint>();
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? 0n) + BigInt(row.net));
  return [...sums.entries()]
    .filter(([, net]) => net !== 0n)
    .map(([currency, net]) => ({ currency, net }))
    .sort((a, b) => (absBig(a.net) < absBig(b.net) ? 1 : absBig(a.net) > absBig(b.net) ? -1 : 0));
}

/** One direction's standing: the biggest currency, then the rest of them. */
export interface DirectionGroup {
  owed: boolean;
  head: CurrencyTotal;
  rest: readonly CurrencyTotal[];
}

/**
 * Fold the per-currency totals into at most two groups — what you are owed, and
 * what you owe.
 *
 * The hero used to print one full-size row per currency, each repeating its own
 * direction word: four currencies meant reading "You're owed" three times, above
 * a panel that grew until it pushed the list off the screen. There are only ever
 * two things being said, so they are said twice, and the other currencies are
 * counted underneath rather than re-announced — the rule the dashboard headline
 * already follows.
 *
 * Owed first, because that is the happier half. `totals` arrives biggest-first,
 * so each group's head is its own largest without sorting again.
 */
export function directionGroups(totals: readonly CurrencyTotal[]): DirectionGroup[] {
  const groups: DirectionGroup[] = [];
  for (const owed of [true, false]) {
    const mine = totals.filter((total) => total.net > 0n === owed);
    const [head, ...rest] = mine;
    if (head) groups.push({ owed, head, rest });
  }
  return groups;
}

/** Which way a person's balance runs, or null when it runs both ways. */
export type PersonDirection = 'owed' | 'owing' | null;

/**
 * The direction to put in a person's caption.
 *
 * Knowable whenever every currency points the same way, not only when there is
 * one of them — somebody who owes you in rupees and in dollars still simply owes
 * you. This used to be answered only for single-currency people, which left
 * every multi-currency row with no caption at all: in a dense list the rows then
 * alternated between two lines and one, and the names stopped sitting on a
 * common grid.
 *
 * A genuinely mixed balance returns null and the caption says nothing, because
 * no single word is true of both halves — the coloured amounts are the honest
 * answer there. An empty list is mixed by the same logic: nothing to claim.
 */
export function personDirection(entries: readonly NetRow[]): PersonDirection {
  if (entries.length === 0) return null;
  if (entries.every((entry) => BigInt(entry.net) > 0n)) return 'owed';
  if (entries.every((entry) => BigInt(entry.net) < 0n)) return 'owing';
  return null;
}
