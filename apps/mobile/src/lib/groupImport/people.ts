/**
 * Who in the file is who in the group.
 *
 * The rule is deliberately narrow. A name is matched for the person only when it
 * is the same as exactly one member's (case, spacing and accents folded), and the
 * screen says so ("Matched by name") so it is never a silent guess. Anything
 * else waits to be chosen: a stranger who shares a first name with you must not
 * quietly become you, and a ghost made by mistake is a person to clean up later.
 */

import { GHOST } from '@waves/core';

/** A member of the group as the mapping sees them. */
export interface PersonOption {
  readonly id: string;
  /** The name the person goes by, for matching (never "You"). */
  readonly name: string;
  readonly isYou: boolean;
}

export { GHOST };

/** Folded the way a person would compare two spellings. */
export function foldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** File name to member id, only where exactly one member has that name. */
export function matchByName(
  people: readonly string[],
  members: readonly PersonOption[],
): Record<string, string> {
  const byName = new Map<string, PersonOption[]>();
  for (const member of members) {
    const key = foldName(member.name);
    if (key === '') continue;
    byName.set(key, [...(byName.get(key) ?? []), member]);
  }
  const matched: Record<string, string> = {};
  const taken = new Set<string>();
  for (const person of people) {
    const found = byName.get(foldName(person));
    if (found?.length !== 1) continue;
    const only = found[0]!;
    // Two names in the file are never matched to one member automatically;
    // merging them is for the person to choose, with the warning in view.
    if (taken.has(only.id)) continue;
    taken.add(only.id);
    matched[person] = only.id;
  }
  return matched;
}

/**
 * The mapping when the People step opens: what the person already chose for names
 * still in the file, the automatic matches for the rest, and nothing for anybody
 * left over (they are asked).
 */
export function seedMapping(
  people: readonly string[],
  previous: Readonly<Record<string, string>>,
  matches: Readonly<Record<string, string>>,
): { mapping: Record<string, string>; matched: Record<string, true> } {
  const mapping: Record<string, string> = {};
  const matched: Record<string, true> = {};
  for (const person of people) {
    const kept = previous[person];
    if (kept !== undefined) mapping[person] = kept;
    else if (matches[person] !== undefined) {
      mapping[person] = matches[person];
      matched[person] = true;
    }
  }
  return { mapping, matched };
}

/** Names that will end up as one person because they were mapped to the same member. */
export function mergedGroups(
  people: readonly string[],
  mapping: Readonly<Record<string, string>>,
): string[][] {
  const byMember = new Map<string, string[]>();
  for (const person of people) {
    const target = mapping[person];
    if (target === undefined || target === GHOST) continue;
    byMember.set(target, [...(byMember.get(target) ?? []), person]);
  }
  return [...byMember.values()].filter((names) => names.length > 1);
}

/** Every name has an answer, ghosts included. */
export function allMapped(
  people: readonly string[],
  mapping: Readonly<Record<string, string>>,
): boolean {
  return people.every((person) => mapping[person] !== undefined);
}
