/**
 * The voice screen's split sheet speaks the add-expense editor's language
 * (a split kind, the people in it and one text entry per person); the two
 * places it writes back to speak others — the agent's proposal
 * (`{ mode, shares: [{ memberId, value }] }`) and the core `SplitParams` the
 * basic review saves with. These are the conversions, kept pure and tested.
 */

import {
  formatMinorInput,
  type CurrencyCode,
  type SplitParams,
  type VoiceAgentAction,
} from '@waves/core';

import { formatEntry, SplitKind, type SplitEntries } from '@/lib/split';

export type AgentSplit = Extract<VoiceAgentAction, { type: 'add_expense' }>['split'];

/** What the sheet edits: who paid, the kind of split, who is in it, and the figures. */
export interface SplitEdit {
  readonly payerId: string;
  readonly kind: SplitKind;
  readonly participants: readonly string[];
  readonly entries: SplitEntries;
}

/** The sheet's seed from an agent proposal. */
export function splitEditFromAgent(
  paidByMemberId: string,
  split: AgentSplit,
  currency: string,
): SplitEdit {
  const participants = [...new Set(split.shares.map((share) => share.memberId))];
  const entries: Record<string, string> = {};
  const kind =
    split.mode === 'exact'
      ? SplitKind.Exact
      : split.mode === 'percent'
        ? SplitKind.Percent
        : split.mode === 'shares'
          ? SplitKind.Shares
          : SplitKind.Equal;
  for (const share of split.shares) {
    if (share.value === undefined) continue;
    entries[share.memberId] =
      kind === SplitKind.Exact && /^\d+$/.test(share.value)
        ? formatMinorInput(BigInt(share.value), currency as CurrencyCode)
        : share.value;
  }
  return { payerId: paidByMemberId, kind, participants, entries };
}

/** The sheet's seed from the basic review's plan. */
export function splitEditFromParams(
  payerId: string,
  params: SplitParams,
  participants: readonly string[],
  currency: string,
): SplitEdit {
  const entries: Record<string, string> = {};
  let kind = SplitKind.Equal;
  if (params.kind === 'exact') {
    kind = SplitKind.Exact;
    for (const id of participants)
      entries[id] = formatMinorInput(params.amounts[id] ?? 0n, currency as CurrencyCode);
  } else if (params.kind === 'percent') {
    kind = SplitKind.Percent;
    for (const id of participants)
      entries[id] = formatEntry('percent', params.basisPoints[id] ?? 0);
  } else if (params.kind === 'shares') {
    kind = SplitKind.Shares;
    for (const id of participants) entries[id] = String(params.weights[id] ?? 0);
  }
  return { payerId, kind, participants: [...participants], entries };
}

/** Core split params back into the agent's proposal shape. */
export function agentSplitFrom(params: SplitParams, participants: readonly string[]): AgentSplit {
  if (params.kind === 'exact')
    return {
      mode: 'exact',
      shares: participants.map((memberId) => ({
        memberId,
        value: String(params.amounts[memberId] ?? 0n),
      })),
    };
  if (params.kind === 'percent')
    return {
      mode: 'percent',
      shares: participants.map((memberId) => ({
        memberId,
        value: formatEntry('percent', params.basisPoints[memberId] ?? 0),
      })),
    };
  if (params.kind === 'shares')
    return {
      mode: 'shares',
      shares: participants.map((memberId) => ({
        memberId,
        value: String(params.weights[memberId] ?? 0),
      })),
    };
  return { mode: 'equal', shares: participants.map((memberId) => ({ memberId })) };
}
