/**
 * Turns what the `voice-agent` function proposed into things a person can read
 * and confirm, using only the local mirror (names, group names, money).
 *
 * Pure: no React, no backend. The screen feeds it the response and a snapshot of
 * the reader's groups and members, and renders the cards it returns. Nothing the
 * model proposes is trusted — an id that is not in the mirror, an amount that is
 * not an integer, or a split that does not add up marks the card `problem`, which
 * the screen shows as "couldn't match" with Confirm disabled (Edit still works
 * for an expense, so a near miss is one tap from fixed).
 */

import {
  computeShares,
  format,
  money,
  type SplitParams,
  type VoiceAgentAction,
  type VoiceAgentResponse,
} from '@waves/core';

export interface AgentLocalMember {
  id: string;
  name: string;
  isViewer: boolean;
}

export interface AgentLocalGroup {
  id: string;
  name: string;
  currency: string;
  members: readonly AgentLocalMember[];
}

export interface AgentLocalData {
  groups: readonly AgentLocalGroup[];
}

/** The words a card is built from — supplied by the screen from i18n. */
export interface VoiceAgentText {
  add: string; // 'Add {amount}'
  paid: string; // '{name} paid'
  you: string; // 'You'
  splitEqual: string; // 'split equally with {names}'
  splitJustPayer: string; // 'not split'
  splitExact: string; // 'split by amounts: {parts}'
  splitPercent: string; // 'split by percent: {parts}'
  splitShares: string; // 'split by shares: {parts}'
  justYou: string; // 'Just for you'
  settle: string; // '{from} paid {to} {amount}'
  remind: string; // 'Remind {name} to settle'
  createGroup: string; // 'Create group {name}'
  withPeople: string; // 'with {names}'
  addMember: string; // 'Add {name} to {group}'
  unknownGroup: string;
  unknownPerson: string;
}

export type AgentCardKind = VoiceAgentAction['type'];

export interface AgentCard {
  key: string;
  kind: AgentCardKind;
  action: VoiceAgentAction;
  /** The pieces of the one-line summary, joined with " · " by the screen. */
  segments: string[];
  /** The ids or amounts did not resolve against the local data. */
  problem: boolean;
}

export interface AgentPlan {
  transcript: string;
  cards: AgentCard[];
  answer: string | null;
  clarify: string | null;
  quota: VoiceAgentResponse['quota'];
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

function parseMinor(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}

function formatMinor(minor: bigint, currency: string): string {
  try {
    return format(money(minor, currency));
  } catch {
    return `${minor.toString()} ${currency}`;
  }
}

/** The signed-in reader's own spoken name is "You". */
function memberName(member: AgentLocalMember, text: VoiceAgentText): string {
  return member.isViewer ? text.you : member.name;
}

export function planVoiceAgentActions(
  response: VoiceAgentResponse,
  local: AgentLocalData,
  text: VoiceAgentText,
): AgentPlan {
  const groups = new Map(local.groups.map((group) => [group.id, group]));
  const cards: AgentCard[] = [];

  response.actions.forEach((action, index) => {
    const key = `${index}:${action.type}`;
    const card = (segments: string[], problem: boolean): void => {
      cards.push({ key, kind: action.type, action, segments, problem });
    };

    switch (action.type) {
      case 'add_expense': {
        const group = groups.get(action.groupId);
        const minor = parseMinor(action.amountMinor);
        const payer = group?.members.find((member) => member.id === action.paidByMemberId);
        const shareMembers = action.split.shares.map((share) =>
          group?.members.find((member) => member.id === share.memberId),
        );
        const problem =
          !group || minor === null || !payer || shareMembers.some((member) => !member);
        const amount = minor === null ? action.amountMinor : formatMinor(minor, action.currency);
        const segments = [fill(text.add, { amount }), action.description];
        segments.push(group?.name ?? text.unknownGroup);
        segments.push(
          payer ? fill(text.paid, { name: memberName(payer, text) }) : text.unknownPerson,
        );
        segments.push(splitPhrase(action, group, payer, text));
        card(segments, problem);
        return;
      }
      case 'add_personal': {
        const minor = parseMinor(action.amountMinor);
        const amount = minor === null ? action.amountMinor : formatMinor(minor, action.currency);
        card([fill(text.add, { amount }), action.description, text.justYou], minor === null);
        return;
      }
      case 'record_settlement': {
        const group = groups.get(action.groupId);
        const from = group?.members.find((member) => member.id === action.fromMemberId);
        const to = group?.members.find((member) => member.id === action.toMemberId);
        const minor = parseMinor(action.amountMinor);
        card(
          [
            fill(text.settle, {
              from: from ? memberName(from, text) : text.unknownPerson,
              to: to ? memberName(to, text) : text.unknownPerson,
              amount: minor === null ? action.amountMinor : formatMinor(minor, action.currency),
            }),
            group?.name ?? text.unknownGroup,
          ],
          !group || !from || !to || minor === null || action.fromMemberId === action.toMemberId,
        );
        return;
      }
      case 'nudge': {
        const group = groups.get(action.groupId);
        const to = group?.members.find((member) => member.id === action.toMemberId);
        card(
          [
            fill(text.remind, { name: to ? memberName(to, text) : text.unknownPerson }),
            group?.name ?? text.unknownGroup,
          ],
          !group || !to,
        );
        return;
      }
      case 'create_group': {
        const names = action.memberNames.filter((name) => name.trim().length > 0);
        const segments = [fill(text.createGroup, { name: action.name }), action.currency];
        if (names.length > 0) segments.push(fill(text.withPeople, { names: names.join(', ') }));
        card(segments, action.name.trim().length === 0);
        return;
      }
      case 'add_member': {
        const group = groups.get(action.groupId);
        card(
          [fill(text.addMember, { name: action.name, group: group?.name ?? text.unknownGroup })],
          !group || action.name.trim().length === 0,
        );
        return;
      }
    }
  });

  return {
    transcript: response.transcript,
    cards,
    answer: response.answer?.trim() ? response.answer.trim() : null,
    clarify: response.clarify?.trim() ? response.clarify.trim() : null,
    quota: response.quota,
  };
}

function splitPhrase(
  action: Extract<VoiceAgentAction, { type: 'add_expense' }>,
  group: AgentLocalGroup | undefined,
  payer: AgentLocalMember | undefined,
  text: VoiceAgentText,
): string {
  const named = (memberId: string): string => {
    const member = group?.members.find((candidate) => candidate.id === memberId);
    return member ? memberName(member, text) : text.unknownPerson;
  };
  const { mode, shares } = action.split;
  if (mode === 'equal') {
    const others = shares.filter((share) => share.memberId !== payer?.id);
    return others.length === 0
      ? text.splitJustPayer
      : fill(text.splitEqual, { names: others.map((share) => named(share.memberId)).join(', ') });
  }
  const parts = shares
    .map((share) => {
      const value =
        mode === 'exact' && /^\d+$/.test(share.value ?? '')
          ? formatMinor(BigInt(share.value as string), action.currency)
          : mode === 'percent'
            ? `${share.value ?? ''}%`
            : (share.value ?? '');
      return `${named(share.memberId)} ${value}`;
    })
    .join(', ');
  return fill(
    mode === 'exact' ? text.splitExact : mode === 'percent' ? text.splitPercent : text.splitShares,
    { parts },
  );
}

/** What `useWriteExpense().mutateAsync` takes, derived from a proposed expense. */
export interface AgentExpenseWrite {
  expenseId: string;
  description: string;
  category: string | null;
  expenseDate: string;
  currency: string;
  amount: bigint;
  splitParams: SplitParams;
  participants: string[];
  payers: Record<string, bigint>;
  expectedShares: Record<string, bigint>;
}

/**
 * The write for a proposed expense, or null when it does not hold together (bad
 * amount, an unknown member, shares that do not add up). `expenseId` is minted by
 * the caller once per card so a retry appends no duplicate.
 */
export function expenseWriteFromAction(
  action: Extract<VoiceAgentAction, { type: 'add_expense' }>,
  group: AgentLocalGroup | undefined,
  expenseId: string,
  today: string,
): AgentExpenseWrite | null {
  const amount = parseMinor(action.amountMinor);
  if (!group || amount === null) return null;
  const known = new Set(group.members.map((member) => member.id));
  if (!known.has(action.paidByMemberId)) return null;
  const participants = [...new Set(action.split.shares.map((share) => share.memberId))];
  if (participants.length === 0 || participants.some((id) => !known.has(id))) return null;

  let splitParams: SplitParams;
  try {
    const valueOf = (memberId: string): string =>
      action.split.shares.find((share) => share.memberId === memberId)?.value ?? '';
    switch (action.split.mode) {
      case 'equal':
        splitParams = { kind: 'equal' };
        break;
      case 'exact':
        splitParams = {
          kind: 'exact',
          amounts: Object.fromEntries(participants.map((id) => [id, BigInt(valueOf(id))])),
        };
        break;
      case 'percent':
        splitParams = {
          kind: 'percent',
          basisPoints: Object.fromEntries(
            participants.map((id) => [id, Math.round(Number(valueOf(id)) * 100)]),
          ),
        };
        break;
      case 'shares':
        splitParams = {
          kind: 'shares',
          weights: Object.fromEntries(participants.map((id) => [id, Number(valueOf(id))])),
        };
        break;
    }
    const shares = computeShares({
      amount,
      currency: action.currency,
      params: splitParams,
      participants,
      seed: expenseId,
    });
    return {
      expenseId,
      description: action.description.trim(),
      category: action.category ?? null,
      expenseDate: action.date ?? today,
      currency: action.currency,
      amount,
      splitParams,
      participants,
      payers: { [action.paidByMemberId]: amount },
      expectedShares: Object.fromEntries(shares),
    };
  } catch {
    return null;
  }
}

/** The "7 of 10 advanced commands left this month" numbers. */
export function quotaLeft(quota: VoiceAgentResponse['quota']): { left: number; limit: number } {
  return { left: Math.max(0, quota.limit - quota.used), limit: quota.limit };
}
