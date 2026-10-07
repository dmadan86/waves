/**
 * What this phone has learned about the names its owner says, and the words
 * the recogniser is told to listen for.
 *
 * Pure: the storage lives in `voiceNameStore`. Two kinds of memory, both per
 * group (member ids are per group, and the same word means different people in
 * different groups):
 *
 * - corrections: a heard phrase the owner confirmed or corrected to a member on
 *   the voice review ("rainy" → Renny). The resolver takes them as strong but
 *   bounded evidence — never over somebody else whose name was clearly said.
 * - aliases: a phrase confirmed for the same member twice becomes a name they
 *   answer to ("Ravi" for Ravindra) and is offered to the recogniser — unless
 *   somebody else in the group is called that, in which case it stays a
 *   question.
 */

import {
  aliasCollisions,
  isMeWord,
  nameKey,
  type LearnedName,
  type VoiceNameCandidate,
} from '@waves/core';

export interface NameCorrection {
  /** As {@link nameKey} spells it: name words, lowercased, honorifics out. */
  readonly heard: string;
  readonly memberId: string;
  readonly groupId: string;
  readonly count: number;
  /** Epoch ms of the last confirmation, for keeping the newest. */
  readonly at: number;
}

export interface NameAlias {
  readonly alias: string;
  readonly memberId: string;
  readonly groupId: string;
}

export interface VoiceNameMemory {
  readonly v: 1;
  readonly corrections: readonly NameCorrection[];
  readonly aliases: readonly NameAlias[];
}

export const EMPTY_NAME_MEMORY: VoiceNameMemory = { v: 1, corrections: [], aliases: [] };

/** Enough for every group a person is in; the oldest go first. */
const MAX_CORRECTIONS = 300;
const MAX_ALIASES = 200;
/** Confirmations of one phrase for one member before it becomes their alias. */
const ALIAS_AFTER = 2;
/** At most this many words go to the recogniser (Android and iOS both cap biasing lists). */
export const MAX_VOICE_HINTS = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Whatever was stored, read defensively: anything malformed is dropped, never thrown. */
export function parseNameMemory(raw: string | null | undefined): VoiceNameMemory {
  if (!raw) return EMPTY_NAME_MEMORY;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_NAME_MEMORY;
  }
  if (!isRecord(data) || data.v !== 1) return EMPTY_NAME_MEMORY;
  const corrections = (Array.isArray(data.corrections) ? data.corrections : []).filter(
    (row): row is NameCorrection =>
      isRecord(row) &&
      typeof row.heard === 'string' &&
      typeof row.memberId === 'string' &&
      typeof row.groupId === 'string' &&
      typeof row.count === 'number' &&
      row.count > 0 &&
      typeof row.at === 'number',
  );
  const aliases = (Array.isArray(data.aliases) ? data.aliases : []).filter(
    (row): row is NameAlias =>
      isRecord(row) &&
      typeof row.alias === 'string' &&
      typeof row.memberId === 'string' &&
      typeof row.groupId === 'string',
  );
  return { v: 1, corrections, aliases };
}

export interface NamePick {
  /** The words as heard (the party's `heard`). */
  readonly heard: string;
  readonly memberId: string;
  readonly groupId: string;
  /** The group's members as the resolver sees them, for the alias collision check. */
  readonly members: readonly VoiceNameCandidate[];
  readonly now: number;
}

const titleCase = (text: string): string =>
  text.replace(
    /(^|\s)(\p{L})/gu,
    (_, space: string, letter: string) => space + letter.toUpperCase(),
  );

/**
 * The owner confirmed (or corrected) that `heard` meant this member. Counted
 * per group; a new member for the same words replaces the old one rather than
 * leaving two to tie. On the second confirmation a one-word phrase that is not
 * already the member's own name becomes their alias — if nobody else in the
 * group is called that.
 */
export function recordNamePick(memory: VoiceNameMemory, pick: NamePick): VoiceNameMemory {
  const heard = nameKey(pick.heard);
  if (!heard || !pick.groupId || !pick.memberId || heard.split(' ').some(isMeWord)) return memory;
  const same = (row: NameCorrection): boolean =>
    row.groupId === pick.groupId && row.heard === heard;
  const previous = memory.corrections.find(same);
  const count = previous && previous.memberId === pick.memberId ? previous.count + 1 : 1;
  const corrections = [
    ...memory.corrections.filter((row) => !same(row)),
    { heard, memberId: pick.memberId, groupId: pick.groupId, count, at: pick.now },
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_CORRECTIONS);

  let aliases = memory.aliases;
  const member = pick.members.find((candidate) => candidate.id === pick.memberId);
  const ownWords = member ? nameKey(member.name).split(' ') : [];
  const oneWord = !heard.includes(' ') && heard.length >= 3;
  const known = aliases.some(
    (row) =>
      row.groupId === pick.groupId &&
      row.memberId === pick.memberId &&
      row.alias.toLowerCase() === heard,
  );
  if (
    count >= ALIAS_AFTER &&
    member &&
    !member.isMe &&
    oneWord &&
    !ownWords.includes(heard) &&
    !known &&
    aliasCollisions(heard, pick.memberId, pick.members).length === 0
  )
    aliases = [
      ...aliases,
      { alias: titleCase(heard), memberId: pick.memberId, groupId: pick.groupId },
    ].slice(-MAX_ALIASES);
  return { v: 1, corrections, aliases };
}

/** This group's corrections, as the resolver takes them. */
export function learnedForGroup(
  memory: VoiceNameMemory,
  groupId: string | null | undefined,
): LearnedName[] {
  if (!groupId) return [];
  return memory.corrections
    .filter((row) => row.groupId === groupId)
    .map(({ heard, memberId, count }) => ({ heard, memberId, count }));
}

/**
 * The members with this group's confirmed aliases on them. An alias that has
 * since come to collide with somebody's own name (they joined after it was
 * confirmed) is left off, so the word is asked about again.
 */
export function withAliases(
  members: readonly VoiceNameCandidate[],
  memory: VoiceNameMemory,
  groupId: string | null | undefined,
): VoiceNameCandidate[] {
  if (!groupId) return [...members];
  const byMember = new Map<string, string[]>();
  for (const row of memory.aliases) {
    if (row.groupId !== groupId) continue;
    if (aliasCollisions(row.alias, row.memberId, members).length > 0) continue;
    byMember.set(row.memberId, [...(byMember.get(row.memberId) ?? []), row.alias]);
  }
  return members.map((member) => {
    const aliases = byMember.get(member.id);
    return aliases ? { ...member, aliases: [...(member.aliases ?? []), ...aliases] } : member;
  });
}

/**
 * The words to bias the recogniser towards: every member's display name, first
 * name and confirmed aliases, without repeats, at most {@link MAX_VOICE_HINTS}.
 * Given the current group's members, or everybody across the person's groups.
 */
export function voiceNameHints(
  members: readonly Pick<VoiceNameCandidate, 'name' | 'aliases'>[],
  cap: number = MAX_VOICE_HINTS,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (text: string | undefined): void => {
    const word = text?.trim().replace(/\s+/g, ' ');
    if (!word || out.length >= cap) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(word);
  };
  // Full names first across everybody, then the confirmed aliases, then first
  // names, so a long list that hits the cap still has every person in it once.
  for (const member of members) add(member.name);
  for (const member of members) for (const alias of member.aliases ?? []) add(alias);
  for (const member of members) add(member.name.trim().split(/\s+/)[0]);
  return out;
}
