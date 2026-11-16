/**
 * Which expenses were added by voice, and whether the viewer has seen them yet.
 * Local to the phone: a voice source flag per expense id, and a "last seen"
 * time per space. Opening a space's list moves its watermark, clearing the mark.
 */

export interface VoiceAddedState {
  /** expense / entry id -> its space and when it was added */
  added: Record<string, { g: string; at: number }>;
  /** space id -> when its list was last opened */
  seen: Record<string, number>;
}

export const EMPTY_VOICE_ADDED: VoiceAddedState = { added: {}, seen: {} };

const KEEP = 300;

export function addVoice(
  state: VoiceAddedState,
  groupId: string,
  ids: readonly string[],
  now: number,
): VoiceAddedState {
  const added = { ...state.added };
  for (const id of ids) added[id] = { g: groupId, at: now };
  const keys = Object.keys(added);
  if (keys.length > KEEP) {
    keys.sort((a, b) => added[a]!.at - added[b]!.at);
    for (const key of keys.slice(0, keys.length - KEEP)) delete added[key];
  }
  return { ...state, added };
}

/** Voice-added ids in a space not yet seen; `live` (when given) drops deleted or moved ones. */
export function newVoiceIds(
  state: VoiceAddedState,
  groupId: string,
  live?: ReadonlySet<string>,
): string[] {
  const seen = state.seen[groupId] ?? 0;
  return Object.entries(state.added)
    .filter(([id, row]) => row.g === groupId && row.at > seen && (!live || live.has(id)))
    .map(([id]) => id);
}

export const markSeen = (
  state: VoiceAddedState,
  groupId: string,
  now: number,
): VoiceAddedState => ({ ...state, seen: { ...state.seen, [groupId]: now } });

export function dropVoice(state: VoiceAddedState, id: string): VoiceAddedState {
  const { [id]: _gone, ...added } = state.added;
  return { ...state, added };
}
