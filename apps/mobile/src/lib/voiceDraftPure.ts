/**
 * "Never lost": the moment a sentence is heard it is filed in the capture inbox
 * as an amount-less draft carrying the words, and every later step — a review,
 * a save, a close — either promotes that draft or leaves it be.
 */

import { minorUnitScale } from '@waves/core';

import { parseVoiceExpenses } from '@/lib/voiceExpense';
import { isViewer, type MemberRow } from '@/data/types';

/** Group drafts belong to the speaker by default, never to the first member row. */
export function defaultVoicePayerId(
  members: readonly Pick<MemberRow, 'id' | 'profile_id'>[],
  viewerId: string | null | undefined,
): string | null {
  return members.find((member) => isViewer(member, viewerId))?.id ?? null;
}

/** Keep a guessed payer from replacing the speaker; a spoken payer is respected. */
export function voicePayerId(
  plannedPayerId: string | null,
  payerWasNamed: boolean,
  members: readonly { id: string; isMe?: boolean }[],
): string | null {
  return payerWasNamed
    ? plannedPayerId
    : (members.find((member) => member.isMe)?.id ?? plannedPayerId);
}

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
  // Several expenses in one sentence: the draft shows their total, not ₹0, as
  // long as they share one currency and every amount was read.
  const several =
    read.length > 1 &&
    read.every((item) => item.amountMajor > 0 && (item.currency ?? currency) === filedCurrency);
  const majors = only ? [only.amountMajor] : several ? read.map((item) => item.amountMajor) : [];
  const scale = Number(minorUnitScale(filedCurrency));
  return {
    description: only?.note.trim() || sentence,
    expenseDate: date,
    currency: filedCurrency,
    amount: majors.reduce((sum, major) => sum + BigInt(Math.round(major * scale)), 0n),
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

/**
 * Is a sentence worth filing on arrival? Two characters is a cough, not a
 * command; typed text is never filed behind the reader's back.
 */
export const worthFiling = (transcript: string, typed = false): boolean =>
  !typed && transcript.trim().length >= 2;

/**
 * Leaving the screen: only a review whose rows are all savable is written over
 * the heard draft (with its amounts and group); typed text leaves nothing. In every other state the
 * draft filed on arrival already holds the sentence, so closing just leaves.
 */
export function leaveUpdatesDraft(
  phase: string,
  rows: number,
  allSavable: boolean,
  typed = false,
): boolean {
  return !typed && phase === 'review' && rows > 0 && allSavable;
}

/** An answer to "How much was it?" as the number to speak back to the parser, or null. */
export function unclearAmount(text: string): string | null {
  const cleaned = text.replace(/[,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(cleaned) && Number(cleaned) > 0 ? cleaned : null;
}

/**
 * The draft for what a hold could not add when it added the rest: just those
 * items, so Review never offers the ones already in a group a second time.
 */
export function leftoverCaptureInput(
  transcript: string,
  items: readonly { amountMajor: number; note: string; currency: string | null }[],
  date: string,
  currency: string,
) {
  const sentence = transcript.trim();
  const filedCurrency = items[0]?.currency ?? currency;
  const scale = Number(minorUnitScale(filedCurrency));
  const sameCurrency = items.every((item) => (item.currency ?? currency) === filedCurrency);
  const notes = items.map((item) => item.note.trim()).filter(Boolean);
  return {
    description: notes.length > 0 ? notes.join(', ') : sentence,
    expenseDate: date,
    currency: filedCurrency,
    amount: sameCurrency
      ? items.reduce((sum, item) => sum + BigInt(Math.round(item.amountMajor * scale)), 0n)
      : 0n,
    rawText: sentence,
    parsed: { voiceTranscript: sentence },
  };
}
