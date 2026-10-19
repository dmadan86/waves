/**
 * What a follow-up answer does to the expense that was just saved. Pure: the
 * panel keeps one {@link SavedState}, runs each answer through
 * {@link applyAnswer}, and writes the result with the same hooks the rest of the
 * app writes with (`toPersonalData` for the personal ledger, `toGroupWrite` for a
 * group expense). Nothing here touches storage or the network.
 */

import {
  currencyForCountry,
  encodeTxn,
  guessCategory,
  minorUnitExponent,
  type ExpenseLocation,
  type FilledKind,
  type GroupMemberFact,
  type SavedExpenseFacts,
  type VoiceExpenseUpdate,
} from '@waves/core';

import { rescaleWrite } from '@/lib/assistantRescale';
import type { ConfirmableAction } from '@/lib/voiceConfirmPure';
import type { AgentExpenseWrite } from '@/lib/voiceAgentPlan';

export interface SavedState {
  readonly kind: 'personal' | 'group';
  readonly id: string;
  readonly groupId: string | null;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly category: string | null;
  /** The category was said or chosen, not guessed from the words. */
  readonly categoryStated: boolean;
  readonly date: string;
  /** A group expense's notes. A personal entry has only its description line. */
  readonly notes: string | null;
  readonly place: string | null;
  readonly location: ExpenseLocation | null;
  readonly paymentMethod: string | null;
  /** Group: who paid how much. */
  readonly payers: Readonly<Record<string, bigint>> | null;
  readonly hasReceipt: boolean;
  /** Marked as a work spend to claim back (a real flag on personal and group alike). */
  readonly reimbursable: boolean;
  /** Group: the member ids sharing it. */
  readonly participants: readonly string[];
}

export type FollowUpAnswer =
  | {
      readonly kind: 'place';
      readonly name: string;
      readonly coords?: { lat: number; lng: number };
    }
  | { readonly kind: 'payment'; readonly method: string }
  | { readonly kind: 'category'; readonly category: string }
  | { readonly kind: 'date'; readonly date: string }
  | { readonly kind: 'currency'; readonly currency: string }
  | { readonly kind: 'payer'; readonly memberId: string }
  | { readonly kind: 'work' }
  | { readonly kind: 'note'; readonly text: string };

function appendNote(existing: string | null, addition: string): string {
  const current = existing?.trim() ?? '';
  if (!current) return addition;
  return current.toLowerCase().includes(addition.toLowerCase())
    ? current
    : `${current} · ${addition}`;
}

/** The state after one answer. A kind that does not apply to this expense changes nothing. */
export function applyAnswer(state: SavedState, answer: FollowUpAnswer): SavedState {
  switch (answer.kind) {
    case 'place': {
      const name = answer.name.trim().slice(0, 120);
      if (!name) return state;
      if (state.kind === 'personal') return { ...state, place: name };
      // A group expense keeps a pin when there are coordinates; without them the
      // place travels as a line in the notes, where every member can read it.
      if (answer.coords) {
        return {
          ...state,
          place: name,
          location: { lat: answer.coords.lat, lng: answer.coords.lng, name },
        };
      }
      return { ...state, place: name, notes: appendNote(state.notes, `At ${name}`) };
    }
    case 'payment':
      return { ...state, paymentMethod: answer.method };
    case 'category':
      return { ...state, category: answer.category, categoryStated: true };
    case 'date':
      return { ...state, date: answer.date };
    case 'currency':
      return { ...state, currency: answer.currency.toUpperCase() };
    case 'payer': {
      if (state.kind !== 'group') return state;
      return { ...state, payers: { [answer.memberId]: state.amount } };
    }
    case 'work':
      // A real flag on both: `expense_versions.reimbursable` for a group
      // expense, the ledger blob's `reimbursable` for a personal one.
      return { ...state, reimbursable: true };
    case 'note':
      return state.kind === 'personal'
        ? { ...state, description: appendNote(state.description, answer.text.trim().slice(0, 200)) }
        : { ...state, notes: appendNote(state.notes, answer.text.trim().slice(0, 200)) };
  }
}

/** Which of the closing line's items an answer fills. */
export function filledBy(answer: FollowUpAnswer): FilledKind {
  switch (answer.kind) {
    case 'note':
      return 'place';
    default:
      return answer.kind;
  }
}

/** The personal ledger blob for the state, with the record's unknown fields carried. */
export function toPersonalData(
  state: SavedState,
  carried?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return encodeTxn({
    kind: 'expense',
    amount: state.amount,
    currency: state.currency,
    category: state.category,
    note: state.description,
    date: state.date,
    loanId: null,
    recurringId: null,
    ...(state.paymentMethod ? { paymentMethod: state.paymentMethod } : {}),
    ...(state.place ? { place: state.place } : {}),
    ...(state.reimbursable ? { reimbursable: true } : {}),
    carried,
  });
}

/** The group write for the state: the original write with what the answers changed. */
export function toGroupWrite(
  base: AgentExpenseWrite,
  state: SavedState,
): AgentExpenseWrite & {
  notes: string | null;
  paymentMethod: 'cash' | 'upi' | 'credit' | 'debit' | 'forex' | null;
  location: ExpenseLocation | null;
  reimbursable: boolean;
} {
  // A correction can change the amount, currency, description or who shares it:
  // the split is rebuilt around the state, so shares always add up to the total.
  const rescaled = rescaleWrite(base, {
    amount: state.amount,
    // A group expense keeps its own currency: a relabel there needs a rate.
    currency: base.currency,
    description: state.description,
    participants: state.participants,
  });
  return {
    ...rescaled,
    category: state.category,
    expenseDate: state.date,
    payers: state.payers ? { ...state.payers } : rescaled.payers,
    notes: state.notes,
    paymentMethod: toGroupPayment(state.paymentMethod),
    location: state.location,
    reimbursable: state.reimbursable,
  };
}

/** Group expenses store cash | upi | credit | debit | forex; map the wider voice list onto it. */
export function toGroupPayment(
  method: string | null,
): 'cash' | 'upi' | 'credit' | 'debit' | 'forex' | null {
  switch (method) {
    case 'cash':
    case 'upi':
    case 'credit':
    case 'debit':
    case 'forex':
      return method;
    case 'card':
      return 'credit';
    default:
      return null;
  }
}

/** The payment chips offered: the ledger's own list for each kind of expense. */
export function paymentChoices(kind: 'personal' | 'group'): readonly string[] {
  return kind === 'personal' ? ['cash', 'upi', 'card'] : ['cash', 'upi', 'credit', 'debit'];
}

/** The facts the scorer reads off the state. */
export function factsFor(
  state: SavedState,
  group: { name: string; members: readonly GroupMemberFact[] } | null,
  payerMemberId: string | null,
  myMemberId: string | null,
): SavedExpenseFacts {
  return {
    scope: state.kind,
    expenseId: state.id,
    amountMinor: state.amount,
    currency: state.currency,
    category: state.category,
    categoryStated: state.categoryStated,
    description: state.description,
    date: state.date,
    hasPlace: Boolean(state.place) || state.location !== null,
    hasReceipt: state.hasReceipt,
    hasNotes: Boolean(state.notes?.trim()) || state.reimbursable,
    hasPaymentMethod: Boolean(state.paymentMethod),
    // Only a group expense has somewhere to keep a receipt.
    canAttachReceipt: state.kind === 'group',
    canSetPayment: true,
    groupId: state.groupId,
    groupName: group?.name ?? null,
    members: group?.members ?? [],
    splitParticipantCount: state.participants.length,
    payerIsMe: payerMemberId !== null && payerMemberId === myMemberId,
  };
}

/** The phone's country as a currency, but only when it is directly comparable. */
export function deviceCurrencyFor(
  countryCode: string | null,
  expenseCurrency: string,
): string | null {
  const device = currencyForCountry(countryCode);
  if (!device || device === expenseCurrency.toUpperCase()) return device;
  try {
    return minorUnitExponent(device) === minorUnitExponent(expenseCurrency) ? device : null;
  } catch {
    return null;
  }
}

export interface UpdatePlan {
  readonly answers: readonly FollowUpAnswer[];
  readonly wantsReceipt: boolean;
  readonly splitWith: VoiceExpenseUpdate['splitWith'] | null;
}

/** What a typed or spoken answer's `update_expense` asks the app to do. */
export function planUpdate(update: VoiceExpenseUpdate, state: SavedState): UpdatePlan {
  const answers: FollowUpAnswer[] = [];
  if (update.place) answers.push({ kind: 'place', name: update.place });
  if (update.category) answers.push({ kind: 'category', category: update.category.toLowerCase() });
  if (update.paymentMethod) {
    const method =
      state.kind === 'group' ? toGroupPayment(update.paymentMethod) : update.paymentMethod;
    if (method) answers.push({ kind: 'payment', method });
  }
  if (update.note) answers.push({ kind: 'note', text: update.note });
  return {
    answers,
    // A personal entry has nowhere to keep a receipt.
    wantsReceipt: update.wantsReceipt === true && state.kind === 'group',
    splitWith: state.kind === 'personal' ? (update.splitWith ?? null) : null,
  };
}

/** The state of an expense the agent just saved, from the action that was confirmed. */
export function savedStateFrom(
  action: ConfirmableAction,
  write: AgentExpenseWrite | null,
  id: string,
  today: string,
): SavedState {
  if (action.type === 'add_expense' && write) {
    return {
      kind: 'group',
      id,
      groupId: action.groupId,
      description: write.description,
      amount: write.amount,
      currency: write.currency,
      category: write.category,
      categoryStated: Boolean(write.category),
      date: write.expenseDate,
      notes: null,
      place: null,
      location: null,
      paymentMethod: null,
      payers: write.payers,
      hasReceipt: false,
      reimbursable: false,
      participants: write.participants,
    };
  }
  const description = action.description.trim();
  return {
    kind: 'personal',
    id,
    groupId: null,
    description,
    amount: BigInt(action.amountMinor),
    currency: action.currency,
    category: action.category ?? guessCategory(description),
    categoryStated: Boolean(action.category),
    date: action.date ?? today,
    notes: null,
    place: null,
    location: null,
    paymentMethod: null,
    payers: null,
    hasReceipt: false,
    reimbursable: false,
    participants: [],
  };
}

/** The longest chip label shown; the full text stays in the accessibility label. */
export const CHIP_MAX_CHARS = 24;

/** A chip label cut to {@link CHIP_MAX_CHARS} with an ellipsis. */
export function chipLabel(label: string, max: number = CHIP_MAX_CHARS): string {
  const chars = [...label.trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}
