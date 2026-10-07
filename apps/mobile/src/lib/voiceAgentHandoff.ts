/**
 * Handing an AI-proposed expense to the full form ("Edit" on an agent card)
 * without losing who paid and how it was split.
 *
 * The form already takes the amount, description and category as route params.
 * The payer and split ride along as two more: `payer` (a member id) and `split`
 * (JSON of the proposal's mode and shares). The form decodes them against the
 * group's actual members, so a stale or foreign id simply falls back to the
 * form's own default rather than putting a stranger in the split.
 */

import { SplitKind, type SplitEntries } from '@/lib/split';

export interface AgentSplitShare {
  readonly memberId: string;
  /** exact: minor units; percent: 0–100; shares: weight. Absent for equal. */
  readonly value?: string;
}

export interface AgentSplit {
  readonly mode: 'equal' | 'exact' | 'percent' | 'shares';
  readonly shares: readonly AgentSplitShare[];
}

/**
 * The route params that carry an agent proposal's payer and split, plus the
 * `proposal: '1'` marker that tells the form the whole hand-off is a decided
 * proposal (see {@link agentHandoffCategory}), not a capture still being typed.
 */
export function encodeAgentSplitParams(input: {
  paidByMemberId?: string | null;
  split?: AgentSplit | null;
}): { proposal: '1'; payer?: string; split?: string } {
  return {
    proposal: '1',
    ...(input.paidByMemberId ? { payer: input.paidByMemberId } : {}),
    ...(input.split && input.split.shares.length > 0
      ? { split: JSON.stringify({ mode: input.split.mode, shares: input.split.shares }) }
      : {}),
  };
}

export interface DecodedAgentSplit {
  readonly payer: string | null;
  readonly participants: string[];
  readonly splitKind: SplitKind;
  readonly weights: SplitEntries;
  readonly percents: SplitEntries;
  /** Exact shares, still in minor units — the form formats them for its fields. */
  readonly exactMinor: Record<string, bigint>;
}

const KINDS: Record<AgentSplit['mode'], SplitKind> = {
  equal: SplitKind.Equal,
  exact: SplitKind.Exact,
  percent: SplitKind.Percent,
  shares: SplitKind.Shares,
};

/**
 * Read `payer`/`split` back against the group's members. Null when there is
 * nothing usable — the form then keeps its ordinary defaults.
 */
export function decodeAgentSplitParams(
  payerParam: string | undefined,
  splitParam: string | undefined,
  memberIds: readonly string[],
): DecodedAgentSplit | null {
  const known = new Set(memberIds);
  const payer = payerParam && known.has(payerParam) ? payerParam : null;
  let parsed: AgentSplit | null = null;
  if (splitParam) {
    try {
      const raw = JSON.parse(splitParam) as Partial<AgentSplit>;
      if (raw && typeof raw.mode === 'string' && raw.mode in KINDS && Array.isArray(raw.shares)) {
        parsed = raw as AgentSplit;
      }
    } catch {
      parsed = null;
    }
  }
  const shares = (parsed?.shares ?? []).filter(
    (share): share is AgentSplitShare =>
      typeof share?.memberId === 'string' && known.has(share.memberId),
  );
  if (!payer && shares.length === 0) return null;

  const splitKind = parsed && shares.length > 0 ? KINDS[parsed.mode] : SplitKind.Equal;
  const participants = shares.map((share) => share.memberId);
  const weights: SplitEntries = {};
  const percents: SplitEntries = {};
  const exactMinor: Record<string, bigint> = {};
  for (const share of shares) {
    const value = share.value?.trim();
    if (!value) continue;
    if (splitKind === SplitKind.Shares) weights[share.memberId] = value;
    else if (splitKind === SplitKind.Percent) percents[share.memberId] = value;
    else if (splitKind === SplitKind.Exact && /^\d+$/.test(value)) {
      exactMinor[share.memberId] = BigInt(value);
    }
  }
  return { payer, participants, splitKind, weights, percents, exactMinor };
}

/**
 * The category an agent proposal opens the form with, and that it is settled.
 *
 * A capture or quick hand-off without a category lets the form guess one from
 * the description and keep guessing while it is typed. A proposal is already
 * decided: its own category, or else what the form would have guessed from the
 * proposal's description on arrival — and `chosen`, so editing the description
 * afterwards changes only the description.
 */
export function agentHandoffCategory(
  handed: string | undefined,
  description: string,
  guess: (description: string) => string | null,
): { category: string | null; chosen: true } {
  return { category: handed || guess(description) || null, chosen: true };
}

/** The proposal's own date when it named one (YYYY-MM-DD), else none. */
export function agentHandoffDate(handed: string | undefined): string | null {
  return handed && /^\d{4}-\d{2}-\d{2}$/.test(handed) ? handed : null;
}
