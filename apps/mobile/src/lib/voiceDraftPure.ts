/**
 * "Never lost": the moment a sentence is heard it is filed in the capture inbox
 * as an amount-less draft carrying the words, and every later step — a review,
 * a save, a close — either promotes that draft or leaves it be.
 */

import { minorUnitScale } from '@waves/core';

import { parseVoiceExpenses } from '@/lib/voiceExpense';

/**
 * The draft a heard sentence is filed as. When the on-device parser finds one
 * clear expense in it, the draft carries that amount, its currency and what it
 * was for; otherwise the amount is 0 (shown as "Amount?") and the sentence is
 * the description.
 */
export function heardCaptureInput(transcript: string, date: string, currency: string) {
  const sentence = transcript.trim();
  let read: ReturnType<typeof parseVoiceExpenses>['items'] = [];
  try {
    read = parseVoiceExpenses(sentence, []).items;
  } catch {
    // A parser miss must never stop the sentence being filed.
  }
  const only = read.length === 1 && read[0].amountMajor > 0 ? read[0] : null;
  const filedCurrency = only?.currency ?? currency;
  return {
    description: only?.note.trim() || sentence,
    expenseDate: date,
    currency: filedCurrency,
    amount: only
      ? BigInt(Math.round(only.amountMajor * Number(minorUnitScale(filedCurrency))))
      : 0n,
    rawText: sentence,
    parsed: { voiceTranscript: sentence },
  };
}

/** Recover an amount for Review's display from an older voice draft only. */
export function recoveredVoiceDraftAmount(capture: {
  amount: string;
  currency: string;
  expense_date: string;
  raw_text: string | null;
  description: string;
  parsed: Record<string, unknown> | null;
}): { amount: bigint; currency: string } | null {
  if (capture.amount !== '0' || typeof capture.parsed?.voiceTranscript !== 'string') return null;
  const transcript = capture.raw_text || capture.parsed.voiceTranscript;
  const recovered = heardCaptureInput(transcript, capture.expense_date, capture.currency);
  return recovered.amount > 0n ? { amount: recovered.amount, currency: recovered.currency } : null;
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
