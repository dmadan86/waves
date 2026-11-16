/**
 * Pure rules for the voice screen's spaces: which space a spoken expense lands
 * in when the sentence names none, and where a voice-added expense may move.
 */

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
  if (!role || role === 'vendor' || target.archived_at || target.isDemo) return false;
  if (target.type === 'company')
    return !target.suspended_at && !target.slot_lapsed_at && target.default_currency === currency;
  // A group that converts everything to its own currency needs a rate for any other one.
  return target.default_currency === currency || target.convert_to_group_currency !== true;
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
