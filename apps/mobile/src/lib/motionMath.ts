/**
 * The arithmetic behind the app's motion, with no React or React Native in it.
 *
 * Kept apart from `anim` on purpose: a count that lands on the wrong figure or a
 * stagger that never stops is a bug worth a test, and a test should not have to
 * boot a native animation runtime to check a number. Everything here is pure.
 */

/** The largest minor-unit amount a Number can carry without dropping paise. */
export const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

/** Standard ease-out cubic: fast off the mark, settling gently onto the value. */
export function easeOutCubic(t: number): number {
  const remaining = 1 - Math.min(1, Math.max(0, t));
  return 1 - remaining * remaining * remaining;
}

/** Interpolate between two bigints at progress `p` in [0, 1], rounded to the unit. */
export function lerpBig(from: bigint, to: bigint, p: number): bigint {
  if (p >= 1) return to;
  if (p <= 0) return from;
  return from + BigInt(Math.round(Number(to - from) * p));
}

/**
 * How long the row at `index` waits before it arrives. Capped, so a long list
 * lands in a bounded window rather than staggering on for as long as it is.
 */
export function staggerDelay(index: number): number {
  const STEP_MS = 55;
  const CAP = 8;
  return Math.min(Math.max(0, index), CAP) * STEP_MS;
}

/** Tile width that leaves about one third of the next card visible. */
export function docTileWidth(
  containerWidth: number,
  gap: number,
  minWidth: number,
  maxWidth: number,
): number {
  if (containerWidth <= 0) return minWidth;
  // Two full tiles plus one third of the next, with two inter-tile gaps.
  return Math.min(maxWidth, Math.max(minWidth, (containerWidth - gap * 2) / (2 + 1 / 3)));
}

/** Width of one of `count` equal segments in a row of `width` with `inset` padding and `gap` between. */
export function segmentWidth(count: number, width: number, inset = 0, gap = 0): number {
  return count > 0 ? Math.max(0, (width - inset * 2 - gap * (count - 1)) / count) : 0;
}

/** Where segment `index` starts, measured from the row's start edge (before any RTL mirroring). */
export function segmentX(index: number, count: number, width: number, inset = 0, gap = 0): number {
  return inset + index * (segmentWidth(count, width, inset, gap) + gap);
}
