/**
 * Pure rules for answering a follow-up question out loud: the clip limits, the
 * LLM-turn cap, whether the mic may show at all, and the on-device matcher that
 * turns "cash" or "yes" into the chip it names before any model is asked.
 */

/** The clip never runs longer than this, whatever the room sounds like. */
export const REPLY_MAX_MS = 6000;
/** Quiet this long after the last new word ends the clip. */
export const REPLY_SILENCE_MS = 1500;
/** No speech at all by now: give up and say so. */
export const REPLY_FIRST_WORD_MS = 4000;
/** Model turns one saved expense may use across typing and talking (D1). */
export const FOLLOW_UP_TURN_CAP = 3;

export type ReplyPhase = 'idle' | 'listening' | 'transcribing';

export type ReplyProblem = 'denied' | 'unavailable' | 'empty' | 'failed';

export interface ReplyGate {
  online: boolean;
  turnsUsed: number;
  /** This build has a way to hear the mic at all. */
  supported: boolean;
}

/** Why the mic is off, or null when it can be offered. Offline hides it. */
export function replyGate(gate: ReplyGate): 'offline' | 'cap' | 'unsupported' | null {
  if (!gate.online) return 'offline';
  if (gate.turnsUsed >= FOLLOW_UP_TURN_CAP) return 'cap';
  if (!gate.supported) return 'unsupported';
  return null;
}

/** Lower-case, accent-free, punctuation-free, single-spaced. */
export function normaliseAnswer(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface AnswerChip {
  readonly label: string;
  readonly primary?: boolean;
}

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'haan', 'ha', 'ji']);
const NO = new Set(['no', 'nope', 'nah', 'nahi', 'nai']);

/**
 * The index of the one chip a short answer names, or -1 when it names none or
 * more than one (then the model is asked). "yes" picks the first primary chip,
 * "no" the one chip that starts with No; otherwise a chip whose whole label is said.
 */
export function matchChip(transcript: string, chips: readonly AnswerChip[]): number {
  const said = normaliseAnswer(transcript);
  if (!said) return -1;
  if (YES.has(said)) {
    const at = chips.findIndex((c) => c.primary);
    return chips.filter((c) => c.primary).length === 1 ? at : -1;
  }
  if (NO.has(said)) {
    const nos = chips
      .map((c, index) => ({ index, label: normaliseAnswer(c.label) }))
      .filter((c) => c.label === 'no' || c.label.startsWith('no '));
    return nos.length === 1 ? (nos[0] as { index: number }).index : -1;
  }
  const padded = ` ${said} `;
  const hits: number[] = [];
  chips.forEach((chip, index) => {
    const label = normaliseAnswer(chip.label);
    if (label && padded.includes(` ${label} `)) hits.push(index);
  });
  return hits.length === 1 ? (hits[0] as number) : -1;
}
