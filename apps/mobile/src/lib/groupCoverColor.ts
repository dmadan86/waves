/**
 * The hook half of `groupCoverTone`: reads the theme so a tile can be styled in
 * one line. The pure tone lookup lives next door so it can be tested without
 * React Native.
 */

import { useTheme } from '@waves/ui';

import { coverTone } from './groupCoverTone';

export { coverTone, planCoverCommit, type CoverTone } from './groupCoverTone';

/**
 * What a tile should wear: the picked tone, or the caller's own default
 * background with no ink override (so the mark keeps drawing in the brand
 * colour exactly as before).
 */
export function useCoverTile(
  key: string | null | undefined,
  defaultBackground: string,
): { backgroundColor: string; ink: string | undefined } {
  const theme = useTheme();
  const tone = coverTone(key, theme);
  return tone
    ? { backgroundColor: tone.bg, ink: tone.ink }
    : { backgroundColor: defaultBackground, ink: undefined };
}
