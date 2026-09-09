/**
 * Emptying a whole "saved for later" cluster into one group, in one go.
 *
 * The drafts inbox folds expenses caught in one breath into a single
 * collapsible card, and that card's ⋯ can place the lot at once. Assigning them
 * one at a time still exists and is untouched — that path opens the add-expense
 * form per draft, which is where a person goes to say who split what. This is
 * the other half of the same intent: several drafts, one destination, the
 * ordinary defaults.
 *
 * Those defaults are exactly the ones the form itself opens with for a capture:
 * everybody still in the group is in the split, it is split equally, and the
 * person assigning is down as having paid. Nothing here invents a figure the
 * form would not have shown, and every field the form carries over from a
 * capture (`assignCaptureHref`) is carried over here too.
 *
 * The expense takes the capture's own id. It is a uuid, it is unique, and a
 * capture becomes exactly one expense — so a retry after a half-finished run
 * writes the same ledger row again rather than a second copy of the same
 * dinner.
 *
 * Pure on purpose: the screen owns the queue, the sheet and the toast, and this
 * only decides what to write. That is what lets "all of them go, none goes
 * missing, nothing outside the cluster is touched" be tested with no device
 * (mobile's vitest renders nothing; see vitest.config.ts).
 */

import { computeShares, type PaymentMethod, type SplitParams } from '@waves/core';

import type { CaptureRow } from '@/data/types';

/** Everyone in, divided evenly — the add-expense form's own default. */
const EQUAL: SplitParams = { kind: 'equal' };

/** The methods the ledger knows; anything else on a draft is not sent. */
const PAYMENT_METHODS: readonly string[] = ['cash', 'upi', 'credit', 'debit', 'forex'];

/** The member fields a plan reads. `summary.membersFor(groupId)` satisfies it. */
export interface AssignMember {
  readonly id: string;
  readonly profile_id: string | null;
}

/** One draft's expense, ready to be queued as an `expense.create` on the group. */
export interface CaptureAssignWrite {
  /** The draft this closes once the expense is on the queue. */
  readonly captureId: string;
  /** The expense it becomes — the draft's own id, so a retry appends nothing. */
  readonly expenseId: string;
  /** The `/sync` envelope, amounts already decimal strings (bigint is not JSON). */
  readonly payload: Record<string, unknown>;
}

export interface CaptureAssignPlan {
  readonly writes: readonly CaptureAssignWrite[];
  /**
   * Drafts that cannot become an expense at all — an amount that is not a
   * positive whole number of minor units. They are counted as failures and left
   * in the inbox rather than quietly skipped.
   */
  readonly unusable: readonly CaptureRow[];
  /** Set when the group itself cannot take an expense; then `writes` is empty. */
  readonly problem: 'no-members' | null;
}

/** A stored minor-unit amount, or null when the row carries something else. */
function minorAmount(value: string): bigint | null {
  if (!/^-?\d+$/.test(value.trim())) return null;
  try {
    const amount = BigInt(value.trim());
    return amount <= 0n ? null : amount;
  } catch {
    return null;
  }
}

/**
 * The drafts of a cluster that are still waiting.
 *
 * The ⋯ sheet holds the cluster as it looked when it opened; by the time a
 * group is chosen another device may have assigned one of them, and the inbox
 * read (`useCaptures`, open drafts only) will already know. Writing the
 * disappeared one would file the same dinner twice, so the run is narrowed to
 * whatever the inbox still shows — order kept, so the person sees the same list
 * they picked from.
 */
export function stillWaiting(
  items: readonly CaptureRow[],
  open: readonly CaptureRow[],
): CaptureRow[] {
  const ids = new Set(open.map((row) => row.id));
  return items.filter((item) => ids.has(item.id));
}

/**
 * What to write so a whole cluster lands in one group.
 *
 * `myProfileId` decides who is down as having paid: the viewer's own membership
 * when they are in the group, and otherwise the first member, which is the same
 * fallback the voice save uses — an expense with no payer is not a state the
 * ledger has.
 */
export function planCaptureAssign(input: {
  readonly captures: readonly CaptureRow[];
  readonly members: readonly AssignMember[];
  readonly myProfileId: string | null;
  /** The group's own currency — a capture assigned through the form takes it too. */
  readonly currency: string;
}): CaptureAssignPlan {
  const participants = input.members.map((member) => member.id);
  const payer =
    input.members.find((member) => member.profile_id === input.myProfileId)?.id ??
    participants[0] ??
    null;
  if (!payer || participants.length === 0) {
    return { writes: [], unusable: [...input.captures], problem: 'no-members' };
  }

  const writes: CaptureAssignWrite[] = [];
  const unusable: CaptureRow[] = [];

  for (const capture of input.captures) {
    const amount = minorAmount(capture.amount);
    if (amount === null) {
      unusable.push(capture);
      continue;
    }
    const expenseId = capture.id;
    const shares = computeShares({
      amount,
      currency: input.currency,
      params: EQUAL,
      participants,
      seed: expenseId,
    });
    writes.push({
      captureId: capture.id,
      expenseId,
      payload: {
        expenseId,
        // Blank stays blank, exactly as the form leaves it: an undescribed row
        // must not be handed an English word nobody typed.
        description: capture.description.trim(),
        category: capture.category,
        categoryMeta: capture.category_meta,
        // A capture keeps the day it was caught (`expenseDateFor`).
        expenseDate: capture.expense_date,
        currency: input.currency,
        amount: amount.toString(),
        fx: null,
        splitParams: EQUAL,
        participants,
        payers: { [payer]: amount.toString() },
        // How the draft says it was paid, when it says something the ledger
        // knows; the form's own default otherwise.
        paymentMethod: (PAYMENT_METHODS.includes(capture.payment_method ?? '')
          ? capture.payment_method
          : 'cash') as PaymentMethod,
        // The place the draft recorded (A43), kept the way the form keeps it.
        location: capture.location,
        expectedShares: Object.fromEntries(
          [...shares].map(([member, share]) => [member, share.toString()]),
        ),
        // A create, never an edit — there is no earlier version to be based on.
        baseVersionNo: null,
      },
    });
  }

  return { writes, unusable, problem: null };
}
