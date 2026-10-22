/**
 * The assistant's motion, as plain numbers.
 *
 * Every animation the assistant plays (the question card arriving, the
 * confirm card folding into the saved bar, the check popping in, the Undo ring)
 * is described here as data, so the components stay thin and the Reduce Motion
 * rule is one place and testable: when the person asked the OS for less motion,
 * nothing moves and nothing scales. The only thing left is a short fade.
 *
 * Spec section 2.9: collapse 180 ms ease-out; check 0.6 to 1 in 120 ms; question
 * card fades and rises 8 px in 160 ms, and the next question cross-fades in
 * 120 ms; the Undo ring is a 6 s linear stroke on a 16 px circle. Reduce Motion:
 * opacity only, 100 ms.
 */

export type MotionEasing = 'out' | 'linear';

export interface MotionConfig {
  readonly durationMs: number;
  readonly easing: MotionEasing;
  /** Opacity at the start and end of the move. */
  readonly opacity: readonly [number, number];
  /** Vertical offset in points, start to end. Zero throughout means no travel. */
  readonly translateY: readonly [number, number];
  /** Scale, start to end. One throughout means no zoom. */
  readonly scale: readonly [number, number];
  /** Whether the element's height animates (a collapse). */
  readonly animatesHeight: boolean;
}

/** What Reduce Motion leaves: a fade and nothing that travels, grows or collapses. */
export const REDUCED_DURATION_MS = 100;

function reduced(): MotionConfig {
  return {
    durationMs: REDUCED_DURATION_MS,
    easing: 'out',
    opacity: [0, 1],
    translateY: [0, 0],
    scale: [1, 1],
    animatesHeight: false,
  };
}

/** A question card arriving. */
export function questionEnter(reduceMotion: boolean): MotionConfig {
  if (reduceMotion) return reduced();
  return {
    durationMs: 160,
    easing: 'out',
    opacity: [0, 1],
    translateY: [8, 0],
    scale: [1, 1],
    animatesHeight: false,
  };
}

/** The next question replacing the one before it. */
export function questionSwap(reduceMotion: boolean): MotionConfig {
  if (reduceMotion) return reduced();
  return {
    durationMs: 120,
    easing: 'out',
    opacity: [0, 1],
    translateY: [0, 0],
    scale: [1, 1],
    animatesHeight: false,
  };
}

/** The confirm card folding into the saved bar. */
export function cardCollapse(reduceMotion: boolean): MotionConfig {
  if (reduceMotion) return reduced();
  return {
    durationMs: 180,
    easing: 'out',
    opacity: [1, 1],
    translateY: [0, 0],
    scale: [1, 1],
    animatesHeight: true,
  };
}

/** The check icon on the saved bar. */
export function checkPop(reduceMotion: boolean): MotionConfig {
  if (reduceMotion) return reduced();
  return {
    durationMs: 120,
    easing: 'out',
    opacity: [0, 1],
    translateY: [0, 0],
    scale: [0.6, 1],
    animatesHeight: false,
  };
}

/** How long Undo shows its countdown ring before it becomes a plain link (D2). */
export const UNDO_RING_MS = 6000;
export const UNDO_RING_SIZE = 16;

export interface UndoRingConfig {
  readonly durationMs: number;
  readonly size: number;
  /** False under Reduce Motion: the ring is drawn full and does not drain. */
  readonly animated: boolean;
}

export function undoRing(reduceMotion: boolean): UndoRingConfig {
  return { durationMs: UNDO_RING_MS, size: UNDO_RING_SIZE, animated: !reduceMotion };
}

/** Where the Undo ring stands after `elapsedMs`, 1 full to 0 gone. */
export function undoRingProgress(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  if (elapsedMs >= UNDO_RING_MS) return 0;
  return 1 - elapsedMs / UNDO_RING_MS;
}

/** A motion config reduces to opacity only when nothing but opacity differs. */
export function isOpacityOnly(config: MotionConfig): boolean {
  return (
    config.translateY[0] === config.translateY[1] &&
    config.scale[0] === config.scale[1] &&
    !config.animatesHeight
  );
}

/** Chip height; raised from 36 so a thumb can find it. */
export const CHIP_HEIGHT = 40;
/** The longest a chip label runs before it is cut short. */
export const CHIP_LABEL_MAX = 24;
export const CHIP_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

/**
 * A chip label cut to {@link CHIP_LABEL_MAX} characters with an ellipsis. The
 * full text belongs in the chip's accessibility label, never in the pill.
 */
export function chipLabel(label: string, max: number = CHIP_LABEL_MAX): string {
  const clean = label.trim().replace(/\s+/g, ' ');
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}
