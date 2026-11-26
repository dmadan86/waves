/** Voice expenses always stop at the editable review before a write. */
export function voiceSaveDecision(hasExpense: boolean): 'review' | 'no-expense' {
  return hasExpense ? 'review' : 'no-expense';
}

export type VoiceDestination =
  { kind: 'personal' } | { kind: 'group'; groupId: string } | { kind: 'ask' };

/** Resolve only destinations grounded in the launch screen or one spoken match. */
export function voiceDestination(
  launchScope: { kind: 'group'; groupId: string } | { kind: 'personal' } | { kind: 'home' },
  spokenGroupMatches: readonly string[],
  _lastUsed: string | null,
): VoiceDestination {
  if (launchScope.kind === 'personal') return { kind: 'personal' };
  if (launchScope.kind === 'group') return { kind: 'group', groupId: launchScope.groupId };
  return spokenGroupMatches.length === 1
    ? { kind: 'group', groupId: spokenGroupMatches[0]! }
    : { kind: 'ask' };
}
