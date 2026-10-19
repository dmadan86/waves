/**
 * The typed composer's rules, apart from the screen.
 *
 * What is typed goes through the same pipeline as what is said, so it is
 * cleaned the way a transcript is: whitespace collapsed, ends trimmed, capped
 * at a length no spoken sentence reaches.
 */

/** A spoken command is a sentence or two; a pasted essay is not one. */
export const MAX_TYPED_CHARS = 300;

/** The text to send, or null when there is nothing worth sending. */
export function cleanTyped(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return Array.from(collapsed).slice(0, MAX_TYPED_CHARS).join('').trimEnd();
}

export function canSendTyped(raw: string | null | undefined, busy: boolean): boolean {
  return !busy && cleanTyped(raw) !== null;
}

export type TranscriptRoute = 'basic' | 'fast' | 'agent';

/**
 * Who reads a finished sentence, spoken or typed.
 *
 * The agent reads it when it is on and the sentence came by a path that may
 * use it: a cloud stream, a phone-heard clip sent as text, or typed text (which
 * has no audio and is simply text for the model, whichever way the mic would
 * have streamed). "Add another" over an existing batch, and words that came in
 * on a link, always stay on the on-device parser. When the agent could read it
 * but the phone's own parser is already fully confident and no question of the
 * agent's is being answered, the sentence takes the `fast` path: the ordinary
 * review, with no wait and no allowance spent.
 */
export function transcriptRoute(input: {
  agentOn: boolean;
  streamed: boolean;
  phoneToAgent: boolean;
  typed: boolean;
  appending: boolean;
  heardFromLink: boolean;
  answeringAgent: boolean;
  /** Evaluated only when it can matter. */
  localConfident: () => boolean;
}): TranscriptRoute {
  const mayUseAgent =
    input.agentOn &&
    (input.streamed || input.phoneToAgent || input.typed) &&
    !input.appending &&
    !input.heardFromLink;
  if (!mayUseAgent) return 'basic';
  if (!input.answeringAgent && input.localConfident()) return 'fast';
  return 'agent';
}
