/**
 * One row per person on the Settle up cards, not one per currency.
 *
 * The plan holds a transfer per (pair, currency): someone who owes you €25 and
 * ₹2,952.50 is two transfers. Shown as two rows they read as two people and got
 * two reminders. Grouped here, they are one person with their amounts stacked,
 * one reminder, and a chooser only when there is more than one thing to mark.
 *
 * Pure, so the order is a test rather than a screenshot.
 */
import type { PlanTransfer } from '@/lib/settlePlan';

export interface PersonAmount {
  readonly currency: string;
  readonly minor: bigint;
  /** The plan transfer this amount came from, for marking or paying it. */
  readonly transfer: PlanTransfer;
}

export interface PersonDebts {
  readonly memberId: string;
  /** The group's currency first, then larger before smaller, then by code. */
  readonly amounts: readonly PersonAmount[];
}

/**
 * Group transfers by the person on the other side of them (`side`: `from` for
 * "people who owe you", `to` for "people you owe").
 *
 * People are ordered by what they owe in the group currency, largest first.
 * Someone with nothing in the group currency has no figure to rank against
 * those who do (ADR-003: no sum across currencies), so they follow, more
 * currencies first. Ties keep the order the plan listed them in.
 */
export function groupDebtsByPerson(
  transfers: readonly PlanTransfer[],
  side: 'from' | 'to',
  groupCurrency: string,
): PersonDebts[] {
  const byMember = new Map<string, { first: number; amounts: PersonAmount[] }>();
  transfers.forEach((transfer, index) => {
    if (transfer.amount <= 0n) return;
    const memberId = transfer[side];
    const entry = byMember.get(memberId) ?? { first: index, amounts: [] };
    entry.amounts.push({ currency: transfer.currency, minor: transfer.amount, transfer });
    byMember.set(memberId, entry);
  });

  const inGroupCurrency = (amounts: readonly PersonAmount[]): bigint =>
    amounts.reduce((sum, a) => (a.currency === groupCurrency ? sum + a.minor : sum), 0n);

  return Array.from(byMember.entries())
    .map(([memberId, entry]) => ({
      memberId,
      first: entry.first,
      amounts: entry.amounts.slice().sort((a, b) => {
        if (a.currency === groupCurrency && b.currency !== groupCurrency) return -1;
        if (b.currency === groupCurrency && a.currency !== groupCurrency) return 1;
        if (a.minor !== b.minor) return a.minor > b.minor ? -1 : 1;
        return a.currency.localeCompare(b.currency);
      }),
    }))
    .sort((a, b) => {
      const ga = inGroupCurrency(a.amounts);
      const gb = inGroupCurrency(b.amounts);
      if (ga > 0n || gb > 0n) {
        if (ga !== gb) return ga > gb ? -1 : 1;
      } else if (a.amounts.length !== b.amounts.length) {
        return b.amounts.length - a.amounts.length;
      }
      return a.first - b.first;
    })
    .map(({ memberId, amounts }) => ({ memberId, amounts }));
}

/** "€25.00", "€25.00 and ₹2,952.50", "a, b and c" — with the locale's own words. */
export function joinAmounts(parts: readonly string[], and: string, comma: string): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(comma)} ${and} ${parts[parts.length - 1]}`;
}
