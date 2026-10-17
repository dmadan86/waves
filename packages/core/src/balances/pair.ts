/**
 * What one other person owes you (or you owe them), group by group.
 *
 * The person screen and the "Who pays whom" screen both answer this question,
 * and they used to answer it from different places, so the same pair could read
 * one figure on one screen and another on the next. This is the single answer:
 * both screens hand in the same per-group ledger facts and draw whatever comes
 * back, never a figure of their own.
 *
 * Sign is the viewer's: positive means the other person owes you, negative means
 * you owe them. Money never crosses currencies (ADR-003) — every figure is one
 * currency's, and the totals are one per currency.
 *
 * Each group contributes ONE basis, never a blend:
 *   - `direct`: the pairwise balance between the two of you, which is the real
 *     who-owes-whom ledger (the same edges `computePairwiseBalances` yields and
 *     the Friends list sums);
 *   - `simplified`: when the group has Simplify on and the payment it suggests
 *     between the two of you differs from the direct balance, that suggested
 *     amount. Settling by the group's plan means paying exactly this, so this is
 *     the figure to show, and it is labelled as such.
 * A group's total is the sum of its lines; the overall total is the sum of the
 * groups' lines, so a total can never disagree with the rows under it.
 */
import type { PairwiseEdge } from './types';
import type { Transfer } from '../simplify/simplify';

export type PairBasis = 'direct' | 'simplified';

export interface PairGroupInput {
  readonly groupId: string;
  /** The group has Simplify on, so it proposes a reduced plan. */
  readonly simplify: boolean;
  /** The viewer's own member id in this group. */
  readonly viewerMemberId: string;
  /** Every member row of the other person in this group (a merged ghost has more than one). */
  readonly otherMemberIds: readonly string[];
  /** The group's pairwise edges (who really owes whom). */
  readonly edges: readonly PairwiseEdge[];
  /** The group's simplified payment plan, or null when it was not computed. */
  readonly suggested: readonly Transfer[] | null;
}

export interface PairGroupLine {
  readonly currency: string;
  /** What is shown for this group: positive, they owe you; negative, you owe them. */
  readonly net: bigint;
  /** The direct pairwise balance, always carried so a label can say what changed. */
  readonly direct: bigint;
  readonly basis: PairBasis;
}

export interface PairGroup {
  readonly groupId: string;
  /** Non-zero lines only, the biggest first. */
  readonly lines: readonly PairGroupLine[];
  /** True when any line is the group's simplified suggestion. */
  readonly simplified: boolean;
}

export interface PairTotal {
  readonly currency: string;
  readonly net: bigint;
}

export interface PairBalances {
  /** Groups with something outstanding, the biggest first. */
  readonly groups: readonly PairGroup[];
  /** One non-zero total per currency, the biggest first. */
  readonly totals: readonly PairTotal[];
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** Biggest magnitude first; ties by currency code so the order is stable. */
function byMagnitude(
  a: { net: bigint; currency: string },
  b: { net: bigint; currency: string },
): number {
  if (abs(a.net) === abs(b.net)) return a.currency.localeCompare(b.currency);
  return abs(a.net) > abs(b.net) ? -1 : 1;
}

/** The viewer's net against the other person across a set of directed amounts. */
function netBetween(
  entries: readonly { from: string; to: string; currency: string; amount: bigint }[],
  viewer: string,
  others: ReadonlySet<string>,
): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const entry of entries) {
    let delta = 0n;
    if (entry.to === viewer && others.has(entry.from)) delta = entry.amount;
    else if (entry.from === viewer && others.has(entry.to)) delta = -entry.amount;
    if (delta === 0n) continue;
    net.set(entry.currency, (net.get(entry.currency) ?? 0n) + delta);
  }
  return net;
}

export function pairBalances(inputs: readonly PairGroupInput[]): PairBalances {
  const groups: PairGroup[] = [];
  const totals = new Map<string, bigint>();

  for (const input of inputs) {
    const others = new Set(input.otherMemberIds);
    const direct = netBetween(input.edges, input.viewerMemberId, others);
    const suggested =
      input.simplify && input.suggested
        ? netBetween(input.suggested, input.viewerMemberId, others)
        : null;

    const currencies = new Set([...direct.keys(), ...(suggested ? suggested.keys() : [])]);
    const lines: PairGroupLine[] = [];
    for (const currency of currencies) {
      const directNet = direct.get(currency) ?? 0n;
      const plan = suggested ? (suggested.get(currency) ?? 0n) : directNet;
      if (plan === 0n) continue;
      lines.push({
        currency,
        net: plan,
        direct: directNet,
        basis: plan === directNet ? 'direct' : 'simplified',
      });
      totals.set(currency, (totals.get(currency) ?? 0n) + plan);
    }
    if (lines.length === 0) continue;
    lines.sort(byMagnitude);
    groups.push({
      groupId: input.groupId,
      lines,
      simplified: lines.some((line) => line.basis === 'simplified'),
    });
  }

  groups.sort((a, b) => {
    const left = a.lines[0];
    const right = b.lines[0];
    if (left && right && abs(left.net) !== abs(right.net))
      return abs(left.net) > abs(right.net) ? -1 : 1;
    return a.groupId.localeCompare(b.groupId);
  });

  return {
    groups,
    totals: [...totals.entries()]
      .filter(([, net]) => net !== 0n)
      .map(([currency, net]) => ({ currency, net }))
      .sort(byMagnitude),
  };
}
