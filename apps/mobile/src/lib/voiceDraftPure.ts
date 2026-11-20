/**
 * "Never lost": the moment a sentence is heard it is filed in the capture inbox
 * as an amount-less draft carrying the words, and every later step — a review,
 * a save, a close — either promotes that draft or leaves it be.
 */

/** The draft a heard sentence is filed as, before anything has been understood. */
export function heardCaptureInput(transcript: string, date: string, currency: string) {
  const sentence = transcript.trim();
  return {
    description: sentence,
    expenseDate: date,
    currency,
    amount: 0n,
    rawText: sentence,
    parsed: { voiceTranscript: sentence },
  };
}

/** Is a sentence worth filing? Two characters is a cough, not a command. */
export const worthFiling = (transcript: string): boolean => transcript.trim().length >= 2;

/**
 * Leaving the screen: only a review whose rows are all savable is written over
 * the heard draft (with its amounts and group). In every other state the
 * draft filed on arrival already holds the sentence, so closing just leaves.
 */
export function leaveUpdatesDraft(phase: string, rows: number, allSavable: boolean): boolean {
  return phase === 'review' && rows > 0 && allSavable;
}

/** An answer to "How much was it?" as the number to speak back to the parser, or null. */
export function unclearAmount(text: string): string | null {
  const cleaned = text.replace(/[,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(cleaned) && Number(cleaned) > 0 ? cleaned : null;
}
