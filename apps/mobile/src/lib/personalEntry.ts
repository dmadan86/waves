/**
 * The private ledger's one form (A56), as a decision rather than a screen.
 *
 * Putting money into the "Me" tab used to fork before it asked anything: an
 * "Add expense" door, an "Add income" door, and a "Recurring" room holding a
 * second editor that forked the same way again. Four ways in to one question —
 * *what happened?* — and the person had to answer "which screen am I on" first.
 *
 * So the form is now one form, and repeating is a property of the thing rather
 * than a destination of its own. That leaves exactly one decision worth pinning
 * without a renderer: which record kind a save writes, and with what in it. It
 * lives here, free of React, of react-native and of the string tables, so the
 * guarantee that the merged form stores what the two separate ones stored is
 * held by a unit test and not by somebody's memory of a screenshot. The words a
 * cadence is said in are one file over, in `frequencyLabel.ts`, for exactly
 * that reason.
 *
 * Nothing here changes the wire. A `txn` blob and a `recurring` blob are byte
 * for byte what `entry.tsx` and the old inline recurring editor already wrote;
 * `personal_records` is one opaque json column and the server still cannot tell
 * a rule from a loan.
 */

import {
  encodeRecurring,
  encodeTxn,
  Frequency,
  scheduleFor,
  type CurrencyCode,
  type PersonalRecordKind,
  type PersonalRecurring,
  type PersonalTxn,
  type TxnKind,
} from '@waves/core';

/**
 * The repeat half of the form — null when the entry happens once.
 *
 * `interval` and `secondDay` are always carried, even while the chosen pattern
 * ignores them: they are what the two steppers hold, and dropping them on every
 * switch of pattern would lose the "every 5 months" somebody set the moment
 * they glanced at "Monthly" and back.
 */
export interface EntryRepeat {
  readonly frequency: Frequency;
  /** Read only by `everyNMonths`. */
  readonly interval: number;
  /** Read only by `twiceAMonth`. */
  readonly secondDay: number;
  /** Mint the entry when it falls due, rather than only showing it as owed. */
  readonly autoPost: boolean;
  /** A paused rule keeps its history and its place, and fires nothing. */
  readonly active: boolean;
}

/** What the form holds, whichever of the two things it is about to write. */
export interface EntryDraft {
  readonly kind: TxnKind;
  readonly amount: bigint;
  readonly currency: CurrencyCode;
  readonly category: string | null;
  readonly note: string | null;
  /** The day it happened — or, for a repeating entry, the day it starts. */
  readonly date: string;
  /** Set when this entry is a repayment on a loan; links the two. */
  readonly loanId: string | null;
  /** Set when a rule minted the entry being edited; kept so the link survives. */
  readonly recurringId: string | null;
}

/** Exactly the upsert the ledger takes — see `useUpsertPersonalRecord`. */
export interface EntryRecord {
  /** Absent on a create, where the id is minted at the queue. */
  readonly recordId?: string;
  readonly recordKind: PersonalRecordKind;
  readonly data: Record<string, unknown>;
}

/**
 * What one press of Save writes.
 *
 * Two shapes out of one form, chosen by whether the entry repeats — and the
 * important property is that neither shape knows the form exists. A one-off is
 * the same `txn` blob the add-expense and add-income screens each built; a
 * repeating one is the same `recurring` blob the inline rule editor built.
 *
 * `editing` carries the record being changed, and it is what stops a save from
 * quietly rewriting history:
 *
 * - a rule already ahead of its start keeps its place in the queue, and one
 *   whose start has moved forward past it is pulled along with it, so the
 *   auto-post path never goes backwards and re-mints months the timeline can
 *   already show;
 * - `endDate` is carried through untouched. Nothing in the app sets it yet, and
 *   an edit that dropped it would be the first thing that could silently make
 *   a finished rule run forever.
 */
export function entryRecord(
  draft: EntryDraft,
  repeat: EntryRepeat | null,
  editing: { readonly txn?: PersonalTxn; readonly rule?: PersonalRecurring } = {},
): EntryRecord {
  if (repeat === null) {
    return {
      recordId: editing.txn?.id,
      recordKind: 'txn',
      data: encodeTxn({
        kind: draft.kind,
        amount: draft.amount,
        currency: draft.currency,
        category: draft.category,
        note: draft.note,
        date: draft.date,
        loanId: draft.loanId,
        recurringId: draft.recurringId,
      }),
    };
  }

  const rule = editing.rule;
  return {
    recordId: rule?.id,
    recordKind: 'recurring',
    data: encodeRecurring({
      txnKind: draft.kind,
      amount: draft.amount,
      currency: draft.currency,
      category: draft.category,
      note: draft.note,
      ...scheduleFor(repeat.frequency, {
        interval: repeat.interval,
        secondDay: repeat.secondDay,
      }),
      anchorDate: draft.date,
      nextDate: rule && rule.nextDate >= draft.date ? rule.nextDate : draft.date,
      endDate: rule?.endDate ?? null,
      autoPost: repeat.autoPost,
      active: repeat.active,
    }),
  };
}

/** The repeat state an existing rule opens the form in. */
export function repeatOf(rule: PersonalRecurring, frequency: Frequency): EntryRepeat {
  return {
    frequency,
    interval: rule.interval > 1 ? rule.interval : 2,
    secondDay: rule.secondDay ?? 15,
    autoPost: rule.autoPost,
    active: rule.active,
  };
}

/** The repeat state a fresh entry switches on into: monthly, manual, live. */
export const NEW_REPEAT: EntryRepeat = {
  frequency: Frequency.Monthly,
  interval: 2,
  secondDay: 15,
  autoPost: false,
  active: true,
};
