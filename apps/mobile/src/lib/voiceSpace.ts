/**
 * Pure rules for the voice screen's spaces: which space a spoken expense lands
 * in when the sentence names none, and where a voice-added expense may move.
 */

import { isViewer } from '@/data/types';

export interface SpaceRef {
  id: string;
  type?: string | null;
  archived_at?: string | null;
}

/**
 * The space a spoken expense defaults to. A launch group (the mic was opened
 * inside one) beats the saved default; the default counts only while the viewer
 * is still in that space (`memberIds`). A spoken name or "just me" is decided by
 * the caller before this is asked.
 */
export function resolveVoiceSpace(input: {
  launchId: string | null;
  defaultId: string | null;
  memberIds: ReadonlySet<string> | null;
}): string | null {
  if (input.launchId) return input.launchId;
  if (input.defaultId && input.memberIds?.has(input.defaultId)) return input.defaultId;
  return null;
}

/** Spaces a voice-added expense can move to: every other open space the viewer is in. */
export function moveTargets<T extends SpaceRef>(spaces: readonly T[], fromId: string): T[] {
  return spaces.filter((space) => space.id !== fromId && !space.archived_at);
}

export interface MoveTarget extends SpaceRef {
  default_currency?: string | null;
  convert_to_group_currency?: boolean | null;
  suspended_at?: string | null;
  slot_lapsed_at?: string | null;
  isDemo?: boolean;
}

/**
 * May the viewer (their `role` there, null when not an active member) add a
 * `currency` expense to this space? The UI offers only spaces where this is true,
 * so a move the server would turn down is never started.
 */
export function canMoveInto(target: MoveTarget, role: string | null, currency: string): boolean {
  if (!canAddInto(target, role)) return false;
  if (target.type === 'company') return target.default_currency === currency;
  // A group that converts everything to its own currency needs a rate for any other one.
  return target.default_currency === currency || target.convert_to_group_currency !== true;
}

/** The currency-free part of the same test: also what a voice default must pass. */
export function canAddInto(target: MoveTarget, role: string | null): boolean {
  if (!role || role === 'vendor' || target.archived_at || target.isDemo) return false;
  return target.type !== 'company' || (!target.suspended_at && !target.slot_lapsed_at);
}

/** What a (re)try does about the copy: already there, already queued, or not sent yet. */
export function copyStep(there: {
  landed: boolean;
  queuedId: string | null;
}): 'resume' | 'wait' | 'create' {
  return there.landed ? 'resume' : there.queuedId ? 'wait' : 'create';
}

/** The original is removed only once the copy is confirmed; never behind an unconfirmed create. */
export const mayRemoveOriginal = (landed: boolean): boolean => landed;

export interface MoveParties {
  /** Only an equal split can be carried; anything else is not offered. */
  splitKind: string;
  /** People (profile ids) who paid and who share it; null for a ghost, who cannot be matched. */
  payerProfileIds: readonly (string | null)[];
  participantProfileIds: readonly (string | null)[];
  /** The bills attached: a split expense keeps one. */
  photoCount: number;
}

/**
 * Who pays and who shares in the target, or null when the move is not safe to offer.
 * A company entry is one person's spend, so it takes only a "just me" original; a
 * group copy keeps the original's people and equal split, matched by person, and
 * needs every one of them to be in the target.
 */
export function planMove(
  parties: MoveParties,
  target: { type?: string | null },
  targetMembers: readonly { id: string; profile_id: string | null; left_at?: string | null }[],
  viewerId: string | null,
): { payerId: string; participantIds: string[] } | null {
  const { payerProfileIds: payers, participantProfileIds: sharing } = parties;
  if (parties.splitKind !== 'equal' || payers.length !== 1 || sharing.length === 0) return null;
  if ([...payers, ...sharing].some((id) => id === null)) return null;
  const company = target.type === 'company';
  if (!company && parties.photoCount > 1) return null;
  if (company && !(sharing.length === 1 && sharing[0] === viewerId && payers[0] === viewerId))
    return null;
  const live = targetMembers.filter((m) => !m.left_at && m.profile_id);
  const find = (profileId: string | null) => live.find((m) => isViewer(m, profileId))?.id;
  const payerId = find(payers[0]!);
  const participantIds = [...new Set(sharing)].map((id) => find(id));
  if (!payerId || participantIds.some((id) => !id)) return null;
  return { payerId, participantIds: participantIds as string[] };
}

export interface MoveSource {
  amount: bigint;
  currency: string;
  date: string;
  note: string;
  category: string | null;
}

/** What a move carries into the target: the same amount, date and note, shaped for its kind of space. */
export function mapMove(
  source: MoveSource,
  target: { type?: string | null },
): MoveSource & { kind: 'company' | 'group' } {
  const company = target.type === 'company';
  return {
    ...source,
    kind: company ? 'company' : 'group',
    // A company entry always has a category.
    category: company ? (source.category ?? 'other') : source.category,
  };
}
