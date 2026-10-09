/**
 * What one edit to an expense actually changed.
 *
 * Nothing is overwritten in this ledger (ADR-004): an edit writes a new version
 * and the old one stays. That only helps somebody if the screen can say which
 * fields moved — a history that lists each version's total leaves "30,000 →
 * 300" looking like two unrelated rows, which is exactly the bug the phone's
 * audit trail was built to fix.
 *
 * The comparison lives here rather than in either client because both now show
 * it, and two copies of "what counts as a change" is two answers to the same
 * question. What this returns is *facts*: which field, and the two values, in
 * whatever form the value is actually kept. It deliberately produces no
 * sentences and no formatted numbers — a label is a translation and a date or
 * an amount is a locale, and neither belongs in a shared package that cannot
 * see the reader's.
 *
 * So the client decides how to say it. This decides what there is to say.
 */

import { myStake } from '../balances/stake';
import { payerFactsKey, type PayerRow } from './payers';

/** One person's side of the split: who, and what they owe of it. */
export interface ShareRow {
  readonly member_id: string;
  readonly amount: string;
}

/** A point on the map, as an expense carries it (A43). */
export interface DiffLocation {
  readonly lat: number;
  readonly lng: number;
  readonly name?: string | null;
}

/**
 * One version of an expense, as narrowly as the comparison needs it.
 *
 * Typed structurally so an audit projection (no split params, no note) can be
 * diffed without either client widening its read.
 */
export interface DiffVersion {
  /** Total in minor units. A string over the wire, a bigint in the core. */
  readonly amount: string | bigint;
  readonly currency: string;
  readonly description: string | null;
  readonly category: string | null;
  /** The custom-tag snapshot (A42), which carries the tag's own label. */
  readonly category_meta?: { readonly label?: string } | null;
  readonly split_type: string;
  /** The expense's own date, `YYYY-MM-DD`. */
  readonly expense_date: string;
  readonly location?: DiffLocation | null;
  readonly payers: readonly PayerRow[];
  readonly shares: readonly ShareRow[];
  // Everything below is optional on purpose. A caller whose read does not carry
  // a column leaves it out, and a field is only compared when *both* versions
  // have it (`!== undefined`) — so the browser's narrower projection keeps
  // producing exactly the lines it did before, rather than a phantom "notes
  // None → None" for a column it never fetched. `null` is a real answer ("no
  // note"); `undefined` is "not asked".
  readonly notes?: string | null;
  readonly payment_method?: string | null;
  /** The time of day the spend happened, a full ISO timestamp. */
  readonly occurred_at?: string | null;
  readonly receipt_id?: string | null;
  readonly is_deposit?: boolean;
  readonly balance_due_minor?: string | bigint | number | null;
  readonly balance_due_date?: string | null;
  readonly sub_event_id?: string | null;
  /** Weights / percents / items — compared structurally, never shown. */
  readonly split_params?: unknown;
}

/** The vendor-deposit reminder as one fact: it moves as a unit. */
export interface DepositFacts {
  readonly isDeposit: boolean;
  readonly balanceDueMinor: bigint | null;
  readonly balanceDueDate: string | null;
}

/**
 * One field that moved.
 *
 * Every arm carries the old value and the new one in the shape the ledger keeps
 * it, so a client can format each end itself: two amounts with their own
 * currencies (a re-denomination changes both), two ISO dates, two sets of
 * member ids, two category codes with their snapshot labels.
 */
export type ExpenseChange =
  | {
      readonly field: 'stake' | 'amount';
      readonly kind: 'money';
      readonly oldAmount: bigint;
      readonly newAmount: bigint;
      readonly oldCurrency: string;
      readonly newCurrency: string;
      /**
       * Whether these two figures are somebody's balance or the bill's total.
       *
       * A total belongs to nobody, so it is neutral ink — painting ₹10,000
       * green because it is a positive number would have a screen reader
       * announce "you are owed ₹10,000" about a dinner. The viewer's own stake
       * IS a balance, so it wears the sign-derived colour.
       */
      readonly balance: boolean;
    }
  | {
      readonly field: 'description';
      readonly kind: 'text';
      readonly oldText: string;
      readonly newText: string;
    }
  | {
      readonly field: 'category';
      readonly kind: 'category';
      readonly oldCategory: string | null;
      readonly newCategory: string | null;
      /** The custom tag's own label, when the code is a user tag rather than a built-in. */
      readonly oldLabel: string | null;
      readonly newLabel: string | null;
    }
  | {
      readonly field: 'split';
      readonly kind: 'split';
      readonly oldSplit: string;
      readonly newSplit: string;
    }
  | {
      readonly field: 'date';
      readonly kind: 'date';
      readonly oldIso: string;
      readonly newIso: string;
    }
  | {
      readonly field: 'location';
      readonly kind: 'location';
      readonly oldLocation: DiffLocation | null;
      readonly newLocation: DiffLocation | null;
    }
  | {
      readonly field: 'payers';
      readonly kind: 'payers';
      readonly oldPayers: readonly PayerRow[];
      readonly newPayers: readonly PayerRow[];
      readonly oldCurrency: string;
      readonly newCurrency: string;
    }
  | {
      readonly field: 'participants';
      readonly kind: 'members';
      readonly oldShares: readonly ShareRow[];
      readonly newShares: readonly ShareRow[];
      /**
       * Whether the *people* changed, or only what each of them owes.
       *
       * Both are edits to the split and both belong in the audit, but they read
       * differently: a changed set is a list of names, while a reallocation
       * between the same people is only legible with the figures beside them.
       * The client picks its wording from this rather than comparing the sets
       * again to find out which happened.
       */
      readonly membersChanged: boolean;
      readonly oldCurrency: string;
      readonly newCurrency: string;
    }
  | {
      readonly field: 'notes';
      readonly kind: 'text';
      readonly oldText: string;
      readonly newText: string;
    }
  | {
      readonly field: 'paymentMethod';
      readonly kind: 'paymentMethod';
      readonly oldMethod: string | null;
      readonly newMethod: string | null;
    }
  | {
      readonly field: 'time';
      readonly kind: 'time';
      readonly oldIso: string | null;
      readonly newIso: string | null;
    }
  | {
      readonly field: 'receipt';
      readonly kind: 'receipt';
      readonly oldHasReceipt: boolean;
      readonly newHasReceipt: boolean;
      /** One receipt swapped for another: both sides have one, but not the same. */
      readonly replaced: boolean;
    }
  | {
      readonly field: 'deposit';
      readonly kind: 'deposit';
      readonly oldDeposit: DepositFacts;
      readonly newDeposit: DepositFacts;
      /** The currency the old and new balance due are each kept in. */
      readonly oldCurrency: string;
      readonly newCurrency: string;
    }
  | {
      readonly field: 'subEvent';
      readonly kind: 'subEvent';
      readonly oldId: string | null;
      readonly newId: string | null;
    }
  | {
      /**
       * The split's inputs moved (percentages, weights, itemized claims) but its
       * type and resulting shares did not. No values: the params are a shape per
       * split type, and what the reader needs to know is only that it happened.
       */
      readonly field: 'splitDetails';
      readonly kind: 'splitDetails';
    };

/** The set of member ids on a side, sorted, as a stable comparison key. */
function memberKey(rows: readonly { readonly member_id: string }[]): string {
  return rows
    .map((row) => row.member_id)
    .sort()
    .join(',');
}

/**
 * The split as facts: who owes, and how much each of them owes.
 *
 * The amounts belong in the key for the same reason they belong in the payers'
 * one. An exact split moving from 500/500 to 600/400 leaves the total alone, so
 * there is no amount line, and leaves the set of names alone, so a comparison
 * of names only found nothing — the audit said "no tracked field changed" about
 * somebody's share doubling. For a third person on the bill, whose own stake
 * never moved, that was the entire record of the edit.
 */
function shareFactsKey(rows: readonly ShareRow[]): string {
  return rows
    .map((row) => `${row.member_id}:${row.amount}`)
    .sort()
    .join(',');
}

/**
 * A location as a comparison key.
 *
 * A name alone is not enough — two different restaurants can share one — and
 * coordinates alone are not either, since renaming a pin is an edit somebody
 * made. Both, or the absence of both.
 */
function locationKey(location: DiffLocation | null | undefined): string {
  if (!location) return '';
  return `${location.lat},${location.lng},${location.name?.trim() ?? ''}`;
}

/** JSON with object keys sorted, so two equal params compare equal however the
 *  database happened to order them. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(canonicalScalar(value)) ?? 'null';
}

/** 5000 and "5000" mean the same split parameter; numeric-looking values
 *  (numbers and numeric strings) share one canonical string form. */
function canonicalScalar(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return String(Number(value));
  }
  return value;
}

/** Clock time (local hours and minutes) of a timestamp, ignoring the date. */
function timeOfDayKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getHours()}:${d.getMinutes()}`;
}

function depositFacts(version: DiffVersion): DepositFacts {
  return {
    isDeposit: version.is_deposit === true,
    balanceDueMinor:
      version.balance_due_minor === null || version.balance_due_minor === undefined
        ? null
        : BigInt(version.balance_due_minor),
    balanceDueDate: version.balance_due_date ?? null,
  };
}

/**
 * Every field that differs between two consecutive versions, in the order a
 * reader wants them: their own stake first, then the bill's own facts.
 *
 * `myMemberId` is the reader. Pass null for somebody with no membership row —
 * the stake line is then left out rather than shown as zero, because "your
 * share 0 → 0" about a bill you are not on is a false statement, not an empty
 * one.
 */
export function diffExpenseVersions(
  prev: DiffVersion,
  cur: DiffVersion,
  myMemberId: string | null,
): ExpenseChange[] {
  const changes: ExpenseChange[] = [];

  // What the edit did to *you*, first. The audit lists the bill's totals, which
  // is the honest record but not the question somebody scrolling their own
  // history is asking — "did this edit cost me anything?" was only answerable
  // by doing the arithmetic against two versions of the split.
  const oldStake = myStake(prev, myMemberId);
  const newStake = myStake(cur, myMemberId);
  // A currency change counts against your stake for the same reason it counts
  // against the amount: ₹500 becoming $500 is not the same stake, and comparing
  // minor units alone would call it one. It only counts for somebody who has a
  // stake, though — `myStake` answers null for a viewer the bill does not
  // involve, and a re-denomination must not hand them a "your share 0 → 0".
  const involved = oldStake !== null || newStake !== null;
  if ((oldStake ?? 0n) !== (newStake ?? 0n) || (involved && prev.currency !== cur.currency)) {
    changes.push({
      field: 'stake',
      kind: 'money',
      oldAmount: oldStake ?? 0n,
      newAmount: newStake ?? 0n,
      oldCurrency: prev.currency,
      newCurrency: cur.currency,
      balance: true,
    });
  }

  if (BigInt(prev.amount) !== BigInt(cur.amount) || prev.currency !== cur.currency) {
    changes.push({
      field: 'amount',
      kind: 'money',
      oldAmount: BigInt(prev.amount),
      newAmount: BigInt(cur.amount),
      oldCurrency: prev.currency,
      newCurrency: cur.currency,
      balance: false,
    });
  }

  const oldDescription = (prev.description ?? '').trim();
  const newDescription = (cur.description ?? '').trim();
  if (oldDescription !== newDescription) {
    changes.push({
      field: 'description',
      kind: 'text',
      oldText: oldDescription,
      newText: newDescription,
    });
  }

  if (
    (prev.category ?? '') !== (cur.category ?? '') ||
    (prev.category_meta?.label ?? null) !== (cur.category_meta?.label ?? null)
  ) {
    changes.push({
      field: 'category',
      kind: 'category',
      oldCategory: prev.category ?? null,
      newCategory: cur.category ?? null,
      oldLabel: prev.category_meta?.label ?? null,
      newLabel: cur.category_meta?.label ?? null,
    });
  }

  if (prev.split_type !== cur.split_type) {
    changes.push({
      field: 'split',
      kind: 'split',
      oldSplit: prev.split_type,
      newSplit: cur.split_type,
    });
  }

  if (prev.expense_date !== cur.expense_date) {
    changes.push({
      field: 'date',
      kind: 'date',
      oldIso: prev.expense_date,
      newIso: cur.expense_date,
    });
  }

  if (locationKey(prev.location) !== locationKey(cur.location)) {
    changes.push({
      field: 'location',
      kind: 'location',
      oldLocation: prev.location ?? null,
      newLocation: cur.location ?? null,
    });
  }

  // Who paid, and how much each of them put in — both, because on a bill with
  // several payers the amounts are the only thing that need change. Moving ₹100
  // from Asha to Ravi leaves the total alone (so there is no amount line) and
  // the set of names alone, and comparing names only meant that edit vanished
  // from the one screen whose job is to record edits.
  if (payerFactsKey(prev.payers) !== payerFactsKey(cur.payers)) {
    changes.push({
      field: 'payers',
      kind: 'payers',
      oldPayers: prev.payers,
      newPayers: cur.payers,
      oldCurrency: prev.currency,
      newCurrency: cur.currency,
    });
  }

  // Participants: who is splitting the bill and what each of them owes.
  //
  // Named rather than counted, so replacing one person with another (the set
  // changes but the count does not) reads as a real change instead of an
  // identical "3 → 3".
  //
  // The amounts count too, but only when the bill's total held still. A
  // reallocation on an unchanged total — 500/500 becoming 600/400 — moves no
  // other field at all, so without this the audit said "no tracked field
  // changed" about somebody's share going up by ₹100; for a third person on
  // the bill, whose own stake never moved, that was the whole record of the
  // edit. When the total *did* move, every share moves with it on an equal
  // split, and repeating that under its own heading only restates the amount
  // line in more words. So a rescale is left to the amount line, and this line
  // is kept for money moving between people.
  const membersChanged = memberKey(prev.shares) !== memberKey(cur.shares);
  const total = (rows: readonly ShareRow[]) =>
    rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const reallocated =
    shareFactsKey(prev.shares) !== shareFactsKey(cur.shares) &&
    total(prev.shares) === total(cur.shares);
  if (membersChanged || reallocated) {
    changes.push({
      field: 'participants',
      kind: 'members',
      oldShares: prev.shares,
      newShares: cur.shares,
      membersChanged,
      oldCurrency: prev.currency,
      newCurrency: cur.currency,
    });
  }

  // The columns below were never compared, so an edit that touched only one of
  // them read "no tracked fields changed" — true of the audit, false of the
  // edit. Each is compared only when both versions carry it (see DiffVersion).
  if (prev.notes !== undefined && cur.notes !== undefined) {
    const oldNotes = (prev.notes ?? '').trim();
    const newNotes = (cur.notes ?? '').trim();
    if (oldNotes !== newNotes) {
      changes.push({ field: 'notes', kind: 'text', oldText: oldNotes, newText: newNotes });
    }
  }

  if (prev.payment_method !== undefined && cur.payment_method !== undefined) {
    // The editor shows a missing method as 'cash', so null -> 'cash' is the
    // editor's default, not a decision.
    const methodKey = (m: string | null | undefined) => m ?? '';
    const sameMethod =
      methodKey(prev.payment_method) === methodKey(cur.payment_method) ||
      (prev.payment_method == null && cur.payment_method === 'cash');
    if (!sameMethod) {
      changes.push({
        field: 'paymentMethod',
        kind: 'paymentMethod',
        oldMethod: prev.payment_method ?? null,
        newMethod: cur.payment_method ?? null,
      });
    }
  }

  if (prev.occurred_at !== undefined && cur.occurred_at !== undefined) {
    if (timeOfDayKey(prev.occurred_at) !== timeOfDayKey(cur.occurred_at)) {
      changes.push({
        field: 'time',
        kind: 'time',
        oldIso: prev.occurred_at ?? null,
        newIso: cur.occurred_at ?? null,
      });
    }
  }

  if (prev.receipt_id !== undefined && cur.receipt_id !== undefined) {
    if ((prev.receipt_id ?? '') !== (cur.receipt_id ?? '')) {
      changes.push({
        field: 'receipt',
        kind: 'receipt',
        oldHasReceipt: !!prev.receipt_id,
        newHasReceipt: !!cur.receipt_id,
        replaced: !!prev.receipt_id && !!cur.receipt_id,
      });
    }
  }

  // The flag and its two reminders are one fact to the reader ("deposit, ₹5,000
  // due 1 Nov"), so they are one change rather than three lines.
  if (prev.is_deposit !== undefined && cur.is_deposit !== undefined) {
    const oldDeposit = depositFacts(prev);
    const newDeposit = depositFacts(cur);
    if (
      oldDeposit.isDeposit !== newDeposit.isDeposit ||
      oldDeposit.balanceDueMinor !== newDeposit.balanceDueMinor ||
      oldDeposit.balanceDueDate !== newDeposit.balanceDueDate
    ) {
      changes.push({
        field: 'deposit',
        kind: 'deposit',
        oldDeposit,
        newDeposit,
        oldCurrency: prev.currency,
        newCurrency: cur.currency,
      });
    }
  }

  if (prev.sub_event_id !== undefined && cur.sub_event_id !== undefined) {
    if ((prev.sub_event_id ?? '') !== (cur.sub_event_id ?? '')) {
      changes.push({
        field: 'subEvent',
        kind: 'subEvent',
        oldId: prev.sub_event_id ?? null,
        newId: cur.sub_event_id ?? null,
      });
    }
  }

  // Only when nothing above already explains it: a changed split type or
  // changed shares are reported under their own lines, and repeating them as
  // "details updated" would say the same edit twice. What is left is the case
  // that used to vanish — 33/33/34 becoming 34/33/33 percent, or an item
  // re-priced so the shares round to the same figures.
  if (
    prev.split_params !== undefined &&
    cur.split_params !== undefined &&
    prev.split_type === cur.split_type &&
    shareFactsKey(prev.shares) === shareFactsKey(cur.shares) &&
    stableJson(prev.split_params) !== stableJson(cur.split_params)
  ) {
    changes.push({ field: 'splitDetails', kind: 'splitDetails' });
  }

  return changes;
}
