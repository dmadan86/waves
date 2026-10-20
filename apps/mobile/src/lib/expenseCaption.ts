/**
 * The small pill under an expense row's amount, decided in one place so the
 * label and its tint can be tested apart from the row. The long forms
 * ("you borrowed") stay as the spoken label; the pill says the short one.
 */
export type CaptionKind = 'owe' | 'get' | 'neutral';

export interface CaptionStrings {
  pillBorrowed: string;
  pillLent: string;
  settledShort: string;
  notInSplit: string;
}

/** `stake` is your effect on the balance: positive lent, negative borrowed, null not in the split. */
export function expenseCaption(
  stake: bigint | null,
  t: CaptionStrings,
): { kind: CaptionKind; label: string } {
  if (stake === null) return { kind: 'neutral', label: t.notInSplit };
  if (stake > 0n) return { kind: 'get', label: t.pillLent };
  if (stake < 0n) return { kind: 'owe', label: t.pillBorrowed };
  return { kind: 'neutral', label: t.settledShort };
}
