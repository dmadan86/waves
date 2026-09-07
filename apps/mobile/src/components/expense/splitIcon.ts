/**
 * One glyph per way of splitting a bill.
 *
 * "Equally", "Shares", "Percent" were three words in a row of identical pills —
 * nothing to aim at, and nothing to recognise afterwards on the expense screen,
 * where the same fact came back as a bare word in a labelled row. The icon is
 * what makes the two screens agree at a glance: the chip you tapped while
 * editing is the mark you see on the bill later.
 *
 * Keyed by the ledger's `split_type` (TDR §8), which is a superset of the three
 * kinds this form offers — an itemized or adjusted split is written by other
 * screens but still has to be shown here.
 *
 * Every glyph here is a *diagram of a division* drawn in the same thin outline
 * weight — a grid, bars, a pie, a keypad, sliders, a list. That rule is the
 * point of the set. The first version mixed a pair of human silhouettes
 * (`people-outline` for an even split) and a banknote (`cash-outline` for typed
 * amounts) in among two thin chart drawings, and side by side in one chip strip
 * the four did not read as four settings of one control: two were dense filled
 * shapes and two were sparse line drawings, so the row looked assembled from
 * whatever was to hand. Anything added here must be another line diagram of how
 * the total divides, not a picture of a person, a wallet or a coin.
 */

import type Ionicons from '@expo/vector-icons/Ionicons';

type IconName = keyof typeof Ionicons.glyphMap;

const SPLIT_ICONS: Record<string, IconName> = {
  // Cells of one size: every share the same.
  equal: 'grid-outline',
  // A keypad, because an exact split is the one you type in figure by figure.
  exact: 'calculator-outline',
  // Slices of a hundred.
  percent: 'pie-chart-outline',
  // Weights: bars of different heights.
  shares: 'stats-chart-outline',
  // Someone's share nudged up or down off the even split.
  adjustment: 'options-outline',
  // Line by line, off the bill itself.
  itemized: 'list-outline',
};

/** The glyph for a split type, falling back to the even-split grid for a value
 *  this build does not know (a newer server writing an older client). */
export function splitIcon(splitType: string): IconName {
  return SPLIT_ICONS[splitType] ?? 'grid-outline';
}
