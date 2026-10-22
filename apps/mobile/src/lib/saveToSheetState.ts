/**
 * Pure state for the voice "Save to" sheet.
 *
 * One `pick` holds the whole destination, so the inbox chip, your own ledger, a
 * group and a set of people can never be selected together: choosing any of them
 * replaces whatever was there. Nothing is written until "Save here".
 */

import type { DestinationSelectionSeed } from '@/lib/destinationPickerState';

export type SaveToPick = DestinationSelectionSeed;

/** A single place (inbox, me, create, a group) replaces the pick outright. */
export function pickPlace(place: Exclude<SaveToPick, { kind: 'people' | 'none' }>): SaveToPick {
  return place;
}

/** People are a set: tapping one adds or removes it, and a pick that was a place
 *  starts a fresh set. Emptying the set leaves nothing selected. */
export function togglePersonPick(pick: SaveToPick, name: string): SaveToPick {
  const trimmed = name.trim();
  if (!trimmed) return pick;
  const lower = trimmed.toLowerCase();
  const names = pick.kind === 'people' ? pick.names : [];
  const next = names.some((entry) => entry.toLowerCase() === lower)
    ? names.filter((entry) => entry.toLowerCase() !== lower)
    : [...names, trimmed];
  return next.length > 0 ? { kind: 'people', names: next } : { kind: 'none' };
}

export function canSaveHere(pick: SaveToPick): boolean {
  return pick.kind !== 'none';
}

/** "5 members" plus " · Oct 11 – Oct 18" when the group has dates. */
export function groupSubtitle(
  memberLabel: string,
  startDate: string | null,
  endDate: string | null,
  formatDay: (iso: string) => string,
): string {
  if (!startDate || !endDate) return memberLabel;
  return `${memberLabel} · ${formatDay(startDate)} – ${formatDay(endDate)}`;
}

/** The 1:1 group a seeded selection stands for, if it is one. */
export function seededPerson<P extends { name: string; groupId: string }>(
  selection: DestinationSelectionSeed,
  people: readonly P[],
): P | undefined {
  return selection.kind === 'existing'
    ? people.find((person) => person.groupId === selection.groupId)
    : undefined;
}

/** The group id to keep when the pick is still exactly the seeded 1:1 contact.
 *  Names are ambiguous (two "Alex" 1:1s), so only a changed pick is resolved by name. */
export function unchangedSeedGroupId(
  pick: SaveToPick,
  seed: { name: string; groupId: string } | undefined,
): string | null {
  return seed &&
    pick.kind === 'people' &&
    pick.names.length === 1 &&
    pick.names[0].toLowerCase() === seed.name.toLowerCase()
    ? seed.groupId
    : null;
}
