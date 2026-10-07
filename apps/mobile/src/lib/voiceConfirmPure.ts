/**
 * The pure half of the voice confirmation screen: what its editable fields
 * show for a proposed expense, how an edit to them turns back into a proposal,
 * and which groups are offered as tiles.
 *
 * The proposal stays the source of truth. The screen shows four things a person
 * can change in place — amount, who it was paid for, the group, and a note and
 * category — and everything else (payer, split mode, date) rides along from the
 * proposal untouched. Only a change that makes the old split meaningless (a
 * different group, a different person, a new amount on an exact split) rebuilds
 * it, and then to the one split that is always right: equal.
 */

import { formatMinorInput, parseMinorInput, type VoiceAgentAction } from '@waves/core';

import type { AgentLocalData, AgentLocalGroup, AgentLocalMember } from '@/lib/voiceAgentPlan';

export type AddExpenseAction = Extract<VoiceAgentAction, { type: 'add_expense' }>;

/** What the editable fields hold. All plain strings, so the inputs bind to them directly. */
export interface ConfirmFields {
  groupId: string | null;
  amountText: string;
  personText: string;
  note: string;
  category: string | null;
}

/** How many group tiles precede "Other group". */
export const GROUP_TILE_LIMIT = 5;

/** A person's name as typed, for matching: case, accents and spacing do not matter. */
function norm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function namesIn(text: string): string[] {
  return text
    .split(/,|&|\band\b|\+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** The fields as the proposal first states them. */
export function initialFields(
  action: AddExpenseAction,
  local: AgentLocalData,
  youLabel: string,
): ConfirmFields {
  const group = local.groups.find((candidate) => candidate.id === action.groupId);
  const others = action.split.shares
    .map((share) => group?.members.find((member) => member.id === share.memberId))
    .filter((member): member is AgentLocalMember => !!member && member.id !== action.paidByMemberId)
    .map((member) => (member.isViewer ? youLabel : member.name));
  let amountText = action.amountMinor;
  if (/^\d+$/.test(action.amountMinor)) {
    amountText = formatMinorInput(BigInt(action.amountMinor), action.currency).replace(/\.0+$/, '');
  }
  return {
    groupId: group ? group.id : null,
    amountText,
    personText: others.join(', '),
    note: action.description,
    category: action.category ?? null,
  };
}

/** The member a typed name stands for: an exact match, else the only prefix match. */
export function matchMember(
  group: AgentLocalGroup,
  name: string,
  youLabel: string,
): AgentLocalMember | null {
  const wanted = norm(name);
  if (!wanted) return null;
  if (wanted === norm(youLabel) || wanted === 'me') {
    return group.members.find((member) => member.isViewer) ?? null;
  }
  const exact = group.members.filter((member) => norm(member.name) === wanted);
  if (exact.length === 1) return exact[0] ?? null;
  const first = wanted.split(/\s+/)[0] ?? wanted;
  const partial = group.members.filter((member) => {
    if (member.isViewer) return false;
    const name = norm(member.name);
    const words = name.split(/\s+/);
    return name.startsWith(wanted) || words.includes(wanted) || words[0] === first;
  });
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

export type ConfirmResolution =
  | { ok: true; action: AddExpenseAction }
  | { ok: false; reason: 'group' | 'amount' | 'payer' | 'person'; name?: string };

/**
 * The proposal with the fields applied, or why it cannot be written yet.
 * `initial` is what the fields held on arrival, so an untouched field leaves the
 * proposal's own payer and split exactly as the agent returned them.
 */
export function resolveConfirm(
  original: AddExpenseAction,
  initial: ConfirmFields,
  fields: ConfirmFields,
  local: AgentLocalData,
  youLabel: string,
  fallbackNote: string,
): ConfirmResolution {
  const group = local.groups.find((candidate) => candidate.id === fields.groupId);
  if (!group) return { ok: false, reason: 'group' };

  const amountMinor =
    fields.amountText === initial.amountText
      ? original.amountMinor
      : parseMinorInput(fields.amountText, original.currency).toString();
  if (!/^\d+$/.test(amountMinor) || BigInt(amountMinor) <= 0n) {
    return { ok: false, reason: 'amount' };
  }

  const sameGroup = group.id === original.groupId;
  const samePeople = norm(fields.personText) === norm(initial.personText);
  let paidByMemberId = original.paidByMemberId;
  let split = original.split;

  if (!sameGroup || !samePeople) {
    const payer = sameGroup
      ? group.members.find((member) => member.id === original.paidByMemberId)
      : group.members.find((member) => member.isViewer);
    if (!payer) return { ok: false, reason: 'payer' };
    paidByMemberId = payer.id;
    const ids = [payer.id];
    for (const name of namesIn(fields.personText)) {
      const member = matchMember(group, name, youLabel);
      if (!member) return { ok: false, reason: 'person', name };
      if (!ids.includes(member.id)) ids.push(member.id);
    }
    split = { mode: 'equal', shares: ids.map((memberId) => ({ memberId })) };
  } else if (amountMinor !== original.amountMinor && original.split.mode === 'exact') {
    split = {
      mode: 'equal',
      shares: original.split.shares.map((share) => ({ memberId: share.memberId })),
    };
  }

  const note = fields.note.trim();
  return {
    ok: true,
    action: {
      ...original,
      groupId: group.id,
      amountMinor,
      description: note || fallbackNote,
      category: fields.category ?? undefined,
      paidByMemberId,
      split,
    },
  };
}

/**
 * The group tiles: the one the agent chose first, then the rest by most recent
 * activity, up to `limit`. The order never depends on what is selected, so a tap
 * does not shuffle the tiles. A group picked from "Other group" that would not
 * make the cut takes the last tile, so the choice is always visible.
 */
export function orderGroupTiles(
  groups: readonly AgentLocalGroup[],
  chosenId: string | null,
  selectedId: string | null,
  activityOf: (groupId: string) => number,
  limit: number = GROUP_TILE_LIMIT,
): AgentLocalGroup[] {
  const byRecent = groups
    .map((group, index) => ({ group, index, at: activityOf(group.id) }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : b.at - a.at))
    .map((entry) => entry.group);
  const first = byRecent.find((group) => group.id === chosenId);
  const tiles = [...(first ? [first] : []), ...byRecent.filter((group) => group !== first)].slice(
    0,
    limit,
  );
  const picked = groups.find((group) => group.id === selectedId);
  if (picked && !tiles.includes(picked)) tiles[Math.max(0, tiles.length - 1)] = picked;
  return tiles;
}
