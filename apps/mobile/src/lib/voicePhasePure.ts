export type VoicePhase =
  'listening' | 'thinking' | 'review' | 'committing' | 'answer' | 'agent' | 'saved';

/**
 * The phase the screen may draw. A phase whose card has nothing to show (a review
 * with no rows, an answer or a saved summary with no data, the agent with no
 * session) would hide the stage and render an empty screen; those fall back to
 * the input state instead, so the screen is never blank.
 */
export function drawablePhase(
  phase: VoicePhase,
  have: { drafts: number; answer: boolean; saved: boolean; agent: boolean },
): VoicePhase {
  if (phase === 'review' && have.drafts === 0) return 'listening';
  if (phase === 'answer' && !have.answer) return 'listening';
  if (phase === 'saved' && !have.saved) return 'listening';
  if (phase === 'agent' && !have.agent) return 'listening';
  return phase;
}
