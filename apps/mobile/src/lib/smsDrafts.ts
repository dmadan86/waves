/**
 * Bank messages → drafts in the Review tab.
 *
 * The parsing is `packages/core/src/sms/parse.ts` and the writing is
 * `useCreateCapture`; this is the bit in between, kept pure so the one rule
 * that matters can be pinned by a test rather than trusted to a screen.
 *
 * THE RULE. A message that a person *pasted* is something they chose to hand
 * over, and its text rides along as `rawText` exactly as a scanned receipt's
 * OCR does — the capture form can show it, and an edit can correct against it.
 * A message this app *read out of the inbox* is not that. Nobody handed it
 * over; the app went and got it. So a read draft syncs its parsed fields — what
 * it cost, roughly what for, when — and its body is never written down at all:
 * not into the capture, not into the queue, not to the server. The phone's own
 * Messages app is where that text lives, and one copy of it is enough.
 *
 * That is enforced structurally rather than by remembering: `planSmsDrafts`
 * ignores `bodies` outright for anything in `readKeys`, so a caller that passes
 * them by mistake still cannot leak one. `test/smsDrafts.test.ts` pins both
 * halves, and checks the whole serialised draft for the text rather than only
 * the field it is supposed to be in.
 *
 * THE SECOND RULE, same reason, and it is a prohibition rather than a design:
 * **nothing on this path reports anything to Sentry, Clarity or any analytics.**
 * Not the body, and not the merchant or the amount either. `docs/plan-drafts-
 * and-rules.md` §10 wants the parser's hit rate measured one day; when that is
 * built it may carry counts and confidence buckets and nothing else, and it
 * will be a deliberate addition rather than something already half-wired here.
 * The safest version of "never send the text" is a path with no reporter on it.
 */

import {
  dedupeKey,
  guessCategory,
  parseSms,
  TransactionDirection,
  type CategoryId,
  type ExpenseCandidate,
  type SmsMessage,
} from '@waves/core';

/** Where a draft's message came from. The two are not treated alike. */
export type SmsDraftChannel = 'paste' | 'inbox';

/**
 * What a draft remembers about the message behind it, stored in the capture's
 * `parsed` jsonb — the same untyped field `voiceBatchId` already rides in, so
 * this needs no column and no migration.
 *
 * Everything here is a *fact about* the message, never the message: who sent
 * it, the bank's own reference (as the dedupe key), how much of it was
 * understood, and the last few digits of the card so two cards can be told
 * apart. A body is not on this list and must never be added to it.
 */
export interface SmsDraftProvenance {
  readonly source: 'sms';
  readonly channel: SmsDraftChannel;
  /** Sender id, e.g. "AD-HDFCBK" — so a person can see which bank it was. */
  readonly sender: string | null;
  readonly dedupeKey: string;
  readonly confidence: number;
  readonly accountTail: string | null;
  /** True when the message named no date and its arrival time was used. */
  readonly dateInferred: boolean;
}

/** One draft, ready to be handed to `useCreateCapture` as a `CaptureInput`. */
export interface SmsDraft {
  readonly dedupeKey: string;
  readonly description: string;
  readonly category: CategoryId | null;
  /** 'YYYY-MM-DD', the day the bank said — or the day the message arrived. */
  readonly expenseDate: string;
  readonly currency: string;
  readonly amount: bigint;
  /** The message, on the paste path only. Null on the read path, always. */
  readonly rawText: string | null;
  readonly parsed: SmsDraftProvenance;
}

export interface PlanSmsDraftsInput {
  readonly candidates: readonly ExpenseCandidate[];
  /** The dedupe keys the person has ticked. Nothing unticked is written. */
  readonly chosen: ReadonlySet<string>;
  /**
   * The keys that came out of the phone's own inbox, from a read.
   *
   * Per candidate rather than per batch, because one list can hold both: a
   * person can read the inbox and then paste something the window missed. And
   * deliberately conservative — a message that was *both* read and pasted
   * counts as read, so the stricter rule wins whenever the two overlap.
   */
  readonly readKeys?: ReadonlySet<string>;
  /**
   * Message bodies by dedupe key, from {@link bodiesByKey}. Supplied by the
   * paste screen and **ignored for anything in `readKeys`** — the rule is
   * enforced here rather than asked of the caller.
   */
  readonly bodies?: ReadonlyMap<string, string>;
}

/**
 * Messages are separated by a blank line.
 *
 * A single SMS wraps over several lines of its own, so splitting on every
 * newline would cut most of them in half — and half a message parses to either
 * nothing or, worse, a smaller amount. The count is shown before anything is
 * parsed so a bad paste is visible rather than silently producing two
 * candidates from six messages.
 */
export function splitMessages(blob: string): string[] {
  return blob
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * How many pasted blocks the parser could not read as a spend at all.
 *
 * Counted per block rather than as "blocks minus candidates", because those two
 * differ for reasons that are not failures: two copies of one message collapse
 * into a single candidate, and money coming in is dropped on purpose. Calling
 * either of those "did not look like a payment" would be a lie told to somebody
 * already wondering why their paste came up short.
 *
 * A refund or a salary credit does count as unreadable here, which is the
 * honest reading of the sentence this feeds: they were left out.
 */
export function unreadableCount(bodies: readonly string[]): number {
  let unreadable = 0;
  for (const body of bodies) {
    const parsed = parseSms(body);
    if (!parsed || parsed.direction !== TransactionDirection.Debit) unreadable += 1;
  }
  return unreadable;
}

/**
 * Bodies indexed by the key the candidate for that message will carry.
 *
 * Built by re-parsing rather than by threading the body through core: an
 * `ExpenseCandidate` deliberately does not carry the text it came from, so
 * nothing that logs, serialises or reports a candidate can take a message body
 * with it by accident. Re-running a pure parser over a handful of pasted blocks
 * costs nothing and keeps that property.
 */
export function bodiesByKey(messages: readonly SmsMessage[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const message of messages) {
    const parsed = parseSms(message.body);
    if (!parsed) continue;
    const key = dedupeKey(parsed, parsed.occurredAt ?? message.receivedAt);
    // First wins, matching `proposeFromSms`, which keeps the first of a
    // duplicate pair and drops the rest.
    if (!bodies.has(key)) bodies.set(key, message.body);
  }
  return bodies;
}

/** The ticked candidates, as drafts. Order is the candidates' own. */
export function planSmsDrafts(input: PlanSmsDraftsInput): SmsDraft[] {
  const drafts: SmsDraft[] = [];
  for (const candidate of input.candidates) {
    if (!input.chosen.has(candidate.dedupeKey)) continue;

    // The one line the whole file exists for: a read draft has no body, no
    // matter what the caller passed in `bodies`.
    const read = input.readKeys?.has(candidate.dedupeKey) ?? false;
    const channel: SmsDraftChannel = read ? 'inbox' : 'paste';
    const rawText = read ? null : (input.bodies?.get(candidate.dedupeKey) ?? null);

    // The merchant is the description, the way it is for every other capture.
    // With no merchant the draft has no name — the amount and the day are what
    // the message gave us, and inventing "Card payment" as *stored* text would
    // put a word into the ledger the bank never said. The screen shows that
    // wording; the row keeps the truth.
    const description = candidate.merchant?.trim() ?? '';

    drafts.push({
      dedupeKey: candidate.dedupeKey,
      description,
      category: description ? guessCategory(description) : null,
      expenseDate: candidate.at.slice(0, 10),
      currency: candidate.amount.currency,
      amount: candidate.amount.minor,
      rawText,
      parsed: {
        source: 'sms',
        channel,
        sender: candidate.sender,
        dedupeKey: candidate.dedupeKey,
        confidence: candidate.confidence,
        accountTail: candidate.accountTail,
        dateInferred: candidate.dateInferred,
      },
    });
  }
  return drafts;
}
