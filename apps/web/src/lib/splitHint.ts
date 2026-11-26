/** The line under "Split between" when there is no preview to show yet. */
export function splitHint(
  equal: boolean,
  invalid: boolean,
  words: { invalidSplit: string; splitEquallyNote: string },
): string {
  if (invalid) return words.invalidSplit;
  // Only an equal split can be "split equally"; Exact and Shares are editable here.
  return equal ? words.splitEquallyNote : '';
}
