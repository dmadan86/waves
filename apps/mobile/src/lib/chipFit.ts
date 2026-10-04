/**
 * How many currency chips fit on one line.
 *
 * The Friends hero names each direction's biggest currency large and the rest
 * as small chips beneath it. The row may never wrap (the hero's height is
 * fixed), so this works out, from an estimated width per chip, how many are
 * drawn and how many are left for a trailing "+N" chip.
 */

export interface ChipFit {
  /** How many leading labels are drawn. */
  shown: number;
  /** How many are left out — the "+N" chip's number. */
  hidden: number;
}

export interface ChipMetrics {
  fontSize: number;
  /** Horizontal padding inside a chip, each side. */
  padX: number;
  /** Gap between chips. */
  gap: number;
}

export const CHIP_METRICS: ChipMetrics = { fontSize: 12, padX: 6, gap: 4 };

/** Average glyph width as a fraction of font size; digits and symbols run wide. */
const GLYPH_EM = 0.62;

/** Estimated rendered width of a chip carrying `label`. */
export function estimateChipWidth(label: string, metrics: ChipMetrics = CHIP_METRICS): number {
  return Math.ceil([...label].length * metrics.fontSize * GLYPH_EM + metrics.padX * 2);
}

/**
 * Greedily fit as many chips as `available` allows, leaving room for the
 * "+N" chip whenever anything is left out. At most `max` are drawn.
 */
export function fitChips(
  labels: readonly string[],
  available: number,
  max = 4,
  metrics: ChipMetrics = CHIP_METRICS,
): ChipFit {
  const cap = Math.min(labels.length, max);
  const widths = labels.slice(0, cap).map((label) => estimateChipWidth(label, metrics));

  const rowWidth = (count: number, overflow: number): number => {
    const parts = widths.slice(0, count);
    if (overflow > 0) parts.push(estimateChipWidth(`+${overflow}`, metrics));
    return parts.reduce((sum, w) => sum + w, 0) + Math.max(0, parts.length - 1) * metrics.gap;
  };

  for (let count = cap; count >= 0; count--) {
    const hidden = labels.length - count;
    if (rowWidth(count, hidden) <= available) return { shown: count, hidden };
  }
  // Not even "+N" fits; draw nothing rather than overflow.
  return { shown: 0, hidden: labels.length };
}
