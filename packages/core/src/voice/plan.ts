/**
 * From a resolved {@link VoiceIntent} to the payer, participants and split
 * parameters an expense is written with — or the list of reasons it cannot be
 * yet. A save is only offered when `problems` is empty, so a payer or a person
 * nobody could match is never defaulted into the books.
 */

import type { SplitParams } from '../split/types';
import type { VoiceIntent } from './intent';

export type VoiceSplitProblem =
  | { readonly code: 'payer_unresolved'; readonly name: string }
  | { readonly code: 'participant_unresolved'; readonly name: string }
  | { readonly code: 'no_amount' }
  | { readonly code: 'no_participants' }
  | { readonly code: 'exact_sum_mismatch' }
  | { readonly code: 'percent_sum_mismatch' };

export interface VoiceSplitPlan {
  readonly payerId: string | null;
  /** Member ids the expense is split across. */
  readonly participants: readonly string[];
  readonly params: SplitParams;
  readonly problems: readonly VoiceSplitProblem[];
}

export interface VoiceSplitInput {
  /** Every member of the group the expense is going into. */
  readonly memberIds: readonly string[];
  /** The speaker's own member id in that group. */
  readonly meMemberId?: string | null;
  readonly amountMinor: bigint | null;
}

export function buildVoiceSplit(intent: VoiceIntent, input: VoiceSplitInput): VoiceSplitPlan {
  const problems: VoiceSplitProblem[] = [];
  const me = input.meMemberId ?? null;
  const memberSet = new Set(input.memberIds);

  const idOf = (party: {
    kind: string;
    memberId?: string;
    status: string;
    name: string;
  }): string | null => {
    if (party.memberId && memberSet.has(party.memberId)) return party.memberId;
    if (party.kind === 'me' && me) return me;
    return null;
  };

  const payerId = idOf(intent.payer);
  if (payerId === null) problems.push({ code: 'payer_unresolved', name: intent.payer.name });

  let participants: string[] = [];
  const exact: Record<string, bigint> = {};
  const basisPoints: Record<string, number> = {};

  if (!intent.participants) {
    participants =
      intent.splitMode === 'full_on' && me
        ? input.memberIds.filter((id) => id !== me)
        : [...input.memberIds];
  } else {
    for (const person of intent.participants) {
      const id = idOf(person);
      if (id === null) {
        problems.push({ code: 'participant_unresolved', name: person.name });
        continue;
      }
      if (participants.includes(id)) continue;
      participants.push(id);
      if (person.exactMinor !== undefined) exact[id] = person.exactMinor;
      if (person.percent !== undefined) basisPoints[id] = Math.round(person.percent * 100);
    }
  }
  if (participants.length === 0 && !problems.some((p) => p.code === 'participant_unresolved'))
    problems.push({ code: 'no_participants' });

  let params: SplitParams = { kind: 'equal' };
  if (input.amountMinor === null) problems.push({ code: 'no_amount' });
  if (intent.splitMode === 'exact') {
    const sum = participants.reduce((a, id) => a + (exact[id] ?? 0n), 0n);
    if (input.amountMinor !== null && sum !== input.amountMinor)
      problems.push({ code: 'exact_sum_mismatch' });
    params = { kind: 'exact', amounts: exact };
  } else if (intent.splitMode === 'percent') {
    const sum = participants.reduce((a, id) => a + (basisPoints[id] ?? 0), 0);
    if (sum !== 10000) problems.push({ code: 'percent_sum_mismatch' });
    params = { kind: 'percent', basisPoints };
  }

  return { payerId, participants, params, problems };
}
