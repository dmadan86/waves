/**
 * Drafts into the private ledger — "Just me", from whichever screen offered it.
 *
 * Three screens hold a pile of drafts and a picker asking where they should go,
 * and only one of them — the voice review — could answer "just me". The other
 * two said so in a comment and pinned the row away: *"just me" writes to the
 * personal ledger, which this screen has no path to*. This is that path, so the
 * sentence stops being true and the row can be offered everywhere the question
 * is asked.
 *
 * A personal expense is the simplest thing the app writes. Nobody splits it, so
 * there are no members to resolve, no payer to get wrong, no group currency to
 * reconcile against — the draft's own amount, its own currency, its own day
 * (A48). That is why this planner is so much shorter than `captureBulkAssign`,
 * and it is worth saying out loud: the short one is not the incomplete one.
 *
 * ## The id, and why it is the draft's
 *
 * The record takes the draft's own id. A draft becomes exactly one personal
 * expense, so a run interrupted halfway and retried rewrites the same record
 * rather than filing the same lunch twice — the same reasoning, and the same
 * guarantee, as the expense id in `captureBulkAssign` and `smsPlacement`.
 *
 * ## Pure on purpose
 *
 * The screen owns the queue, the sheet and the toast; this only decides what to
 * write. That is what lets "all of them go, none goes missing, a bad amount is
 * reported rather than skipped" be tested with no device (mobile's vitest
 * renders nothing; see vitest.config.ts).
 */

import { encodeTxn, guessCategory, type CurrencyCode } from '@waves/core';

import type { CaptureRow } from '@/data/types';

/** One draft's personal record, ready to be queued as a `personal.upsert`. */
export interface PersonalWrite {
  /** The draft this closes once the record is on the queue. */
  readonly captureId: string;
  /** The record it becomes — the draft's own id, so a retry appends nothing. */
  readonly recordId: string;
  /** The encoded `data` blob an upsert carries (see `encodeTxn`). */
  readonly data: Record<string, unknown>;
}

export interface PersonalPlan {
  readonly writes: readonly PersonalWrite[];
  /**
   * Drafts that cannot become a record at all — an amount that is not a
   * positive whole number of minor units. Counted as failures and left where
   * they are, never quietly skipped: somebody who sent six and was told six
   * went has no way to notice that five did.
   */
  readonly unusable: readonly CaptureRow[];
  /**
   * Why the first unplannable draft could not be planned, where there was an
   * exception to keep. Null when every refusal was an ordinary one — an amount
   * that is not a positive whole number of minor units needs no explanation
   * beyond being counted.
   *
   * It exists because planning used to be allowed to throw, and a throw here
   * escaped every guard downstream: `runPersonalPlacement` protects each draft
   * individually, but it never gets to run, so the caller's outermost `catch`
   * failed the whole selection with one generic sentence and no way to find out
   * what had actually happened. Planning is total now, and the reason travels
   * with the count instead of replacing it.
   */
  readonly firstError: unknown;
}

/**
 * A stored minor-unit amount, or null when the row carries something else.
 *
 * Typed `unknown` rather than `string` on purpose. `CaptureRow.amount` is
 * declared a string because that is how PostgREST sends a BIGINT, and for a row
 * that came down the wire it always is one — but this function is the boundary
 * where a row stops being trusted, and it used to call `.trim()` on the value
 * first thing. Anything that was not a string reached that call as a
 * `TypeError`, which is thrown out of `planPersonalPlacement`, past the
 * per-draft guard in `runPersonalPlacement` that exists so one bad row cannot
 * take the others down, and into the caller's outermost `catch` — where the
 * whole selection fails at once with "try again in a moment", advice that is
 * false because the next attempt does exactly the same thing.
 *
 * So the shapes a minor-unit amount legitimately travels in are all read here,
 * and everything else is null — a row counted as unusable, which is what the
 * plan already has a word for.
 */
function minorAmount(value: unknown): bigint | null {
  const text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'bigint' || typeof value === 'number'
        ? String(value)
        : null;
  if (text === null || !/^-?\d+$/.test(text)) return null;
  try {
    const amount = BigInt(text);
    return amount <= 0n ? null : amount;
  } catch {
    return null;
  }
}

/**
 * What to write so a pile of drafts lands in the private ledger.
 *
 * `fallbackDescription` is what an unnamed draft is called — the same courtesy
 * the voice save does, rather than filing a row with no note at all. It must be
 * a name for the *thing*, never a status: the callers first passed "Saved for
 * later", which is what the inbox calls a draft still waiting, and which reads
 * as a lie on a finished entry that is waiting for nothing. `voice.anExpense`
 * is the one the voice save already uses for exactly this. The
 * category is the draft's own where it has one and a guess from the description
 * where it does not, which is exactly what the add-expense form would have
 * shown had the person opened it to accept its defaults.
 */
export function planPersonalPlacement(input: {
  readonly captures: readonly CaptureRow[];
  readonly fallbackDescription: string;
}): PersonalPlan {
  const writes: PersonalWrite[] = [];
  const unusable: CaptureRow[] = [];

  let firstError: unknown = null;

  for (const capture of input.captures) {
    // Every draft is planned inside its own guard, for the same reason every
    // draft is *written* inside its own guard one function down: a pile that
    // contains one row this code cannot read is still a pile of good rows, and
    // failing all of them because of one is both wrong and — since the message
    // says to try again — untrue. A row that throws is a row that is unusable;
    // that is a count the plan already carries.
    try {
      const amount = minorAmount(capture.amount);
      if (amount === null) {
        unusable.push(capture);
        continue;
      }
      const note = typeof capture.description === 'string' ? capture.description.trim() : '';
      const description = note || input.fallbackDescription;
      writes.push({
        captureId: capture.id,
        recordId: capture.id,
        data: encodeTxn({
          kind: 'expense',
          amount,
          currency: capture.currency as CurrencyCode,
          category: capture.category ?? guessCategory(description),
          note: description,
          date: capture.expense_date,
          // Neither applies to a draft filed by hand: it repays no loan, and no
          // recurring rule minted it.
          loanId: null,
          recurringId: null,
        }),
      });
    } catch (caught) {
      unusable.push(capture);
      if (firstError === null) firstError = caught;
    }
  }

  return { writes, unusable, firstError };
}

/**
 * Carry out a plan, one draft at a time — the ordering rule, on its own.
 *
 * The effects are handed in rather than reached for, so the one guarantee that
 * makes this safe can actually be tested: **the record is queued first, and the
 * draft is closed only once that has succeeded.** A draft closed against a
 * record that does not exist is a spend that quietly disappeared, and no amount
 * of care at the call sites enforces that — only this loop does.
 *
 * Each draft is its own attempt. One that refuses does not take the others
 * down, and it is left exactly where it was rather than vanishing into a
 * success message that would be a lie. That is also why a failure is counted
 * rather than thrown: the caller needs to say how many landed *and* how many
 * did not, and a throw would lose the first half.
 */
export interface PersonalOutcome {
  readonly done: string[];
  readonly failed: number;
  /**
   * Why the first failure failed, kept rather than dropped.
   *
   * This used to be a bare `catch {}`, and that was a mistake worth naming: the
   * loop counted a refusal and threw away the only thing that could explain it,
   * so the person was told "couldn't save this — try again in a moment" whether
   * the cause was a dead network (true, retry works) or something permanent
   * (false, retry never works), and nothing reached Sentry either. An error
   * nobody looks at is an error nobody can fix.
   *
   * The first rather than all of them: a pile that fails usually fails for one
   * reason, and the caller has room to say one thing.
   */
  readonly firstError: unknown;
}

export async function runPersonalPlacement(input: {
  readonly plan: PersonalPlan;
  /** Queue the record. Rejecting means the draft is kept. */
  readonly upsert: (write: PersonalWrite) => Promise<unknown>;
  /** Close the draft. Only ever called after `upsert` has resolved. */
  readonly close: (captureId: string) => Promise<unknown>;
}): Promise<PersonalOutcome> {
  const done: string[] = [];
  // A draft whose amount the ledger cannot take never had a write to try, so it
  // starts out already counted as a failure rather than being skipped silently.
  let failed = input.plan.unusable.length;
  // Seeded from the plan, so a draft that could not even be *planned* carries
  // its reason into the same report as one the queue refused. Undefined rather
  // than null is what "nothing to say" means here, matching the loop below.
  let firstError: unknown = input.plan.firstError ?? undefined;

  for (const write of input.plan.writes) {
    try {
      await input.upsert(write);
      await input.close(write.captureId);
      done.push(write.captureId);
    } catch (caught) {
      failed += 1;
      if (firstError === undefined) firstError = caught;
    }
  }

  return { done, failed, firstError };
}
