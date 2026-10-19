/**
 * Corrections after an expense is saved, on the phone. A typed or spoken
 * "no, make it 800" / "it was yesterday" / "undo" is read by core's
 * `parseCorrection` first, then by small local matchers (a recent place, a
 * payment word, a category), and only text neither can read goes to the agent.
 * So the common correction costs no LLM turn and works offline.
 *
 * Everything here is pure or takes its effects as arguments; the panel supplies
 * the real writes (`persist`, `move`, `send`) and renders the line returned.
 */

import {
  computeShares,
  correctionFieldNames,
  format,
  guessCategory,
  money,
  parseCorrection,
  type CorrectionField,
  type CorrectionFields,
  type VoiceAgentResponse,
  type VoiceExpenseUpdate,
} from '@waves/core';

import { scaleAmounts } from '@/lib/assistantRescale';
import {
  applyAnswer,
  paymentChoices,
  planUpdate,
  toGroupPayment,
  toGroupWrite,
  toPersonalData,
  type FollowUpAnswer,
  type SavedState,
} from '@/lib/followUpApply';
import type { VoiceAgentResult } from '@/lib/voiceAgentPure';
import type { AgentExpenseWrite, AgentLocalData } from '@/lib/voiceAgentPlan';

/** The strings the correction line is built from (`t.corrections`). */
export interface CorrectionStrings {
  readonly changedAmount: string;
  readonly changedDate: string;
  readonly changedName: string;
  readonly changedCurrency: string;
  readonly changedGroup: string;
  readonly changedPayer: string;
  readonly personalName: string;
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? '');

/* ───────────────────────── applying fields to the state ───────────────────────── */

/**
 * The state after the fields are applied. A move to another group is separate
 * ({@link planMove}); `groupId` here is ignored. A description change re-guesses
 * the category unless the person had said one.
 */
export function applyCorrectionFields(state: SavedState, fields: CorrectionFields): SavedState {
  let next: SavedState = state;
  if (fields.amountMinor !== undefined && fields.amountMinor > 0n) {
    next = {
      ...next,
      amount: fields.amountMinor,
      payers: next.payers ? scaleAmounts(next.payers, state.amount, fields.amountMinor) : null,
    };
  }
  // A group expense keeps its group's currency; relabelling it would need a rate.
  if (fields.currency && state.kind === 'personal')
    next = { ...next, currency: fields.currency.toUpperCase() };
  if (fields.date) next = { ...next, date: fields.date };
  if (fields.description) {
    const description = fields.description.trim().slice(0, 120);
    if (description) {
      next = {
        ...next,
        description,
        category: next.categoryStated
          ? next.category
          : (guessCategory(description) ?? next.category),
      };
    }
  }
  if (fields.payerMemberId && next.kind === 'group') {
    next = { ...next, payers: { [fields.payerMemberId]: next.amount } };
  }
  return next;
}

/** Which fields actually differ between two states, by correction field name. */
export function changedFields(before: SavedState, after: SavedState): CorrectionField[] {
  const out: CorrectionField[] = [];
  if (before.amount !== after.amount) out.push('amountMinor');
  if (before.date !== after.date) out.push('date');
  if (before.description !== after.description) out.push('description');
  if (before.currency !== after.currency) out.push('currency');
  if (before.groupId !== after.groupId) out.push('groupId');
  if (
    JSON.stringify(Object.keys(before.payers ?? {})) !==
    JSON.stringify(Object.keys(after.payers ?? {}))
  ) {
    out.push('payerMemberId');
  }
  return out;
}

export interface LineContext {
  readonly strings: CorrectionStrings;
  readonly locale: string;
  readonly local: AgentLocalData;
}

function shortDate(date: string, locale: string): string {
  const stamp = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(stamp.getTime())) return date;
  try {
    return stamp.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  } catch {
    return date;
  }
}

/** "Changed to ₹800 · Dated 18 Oct ✓" for the fields that changed. */
export function correctionLine(
  after: SavedState,
  changed: readonly CorrectionField[],
  ctx: LineContext,
): string {
  const parts: string[] = [];
  for (const field of changed) {
    switch (field) {
      case 'amountMinor':
        parts.push(
          fill(ctx.strings.changedAmount, {
            amount: format(money(after.amount, after.currency), { locale: ctx.locale }),
          }),
        );
        break;
      case 'date':
        parts.push(fill(ctx.strings.changedDate, { date: shortDate(after.date, ctx.locale) }));
        break;
      case 'description':
        parts.push(fill(ctx.strings.changedName, { name: after.description }));
        break;
      case 'currency':
        parts.push(fill(ctx.strings.changedCurrency, { currency: after.currency }));
        break;
      case 'groupId': {
        const where =
          after.kind === 'personal'
            ? ctx.strings.personalName
            : (ctx.local.groups.find((g) => g.id === after.groupId)?.name ?? '');
        parts.push(fill(ctx.strings.changedGroup, { where }));
        break;
      }
      case 'payerMemberId': {
        const group = ctx.local.groups.find((g) => g.id === after.groupId);
        const payerId = Object.keys(after.payers ?? {})[0];
        const name = group?.members.find((m) => m.id === payerId)?.name ?? '';
        parts.push(fill(ctx.strings.changedPayer, { name }));
        break;
      }
    }
  }
  return `${parts.join(' · ')} ✓`;
}

/* ───────────────────────────── moving to another ledger ───────────────────────────── */

export type MovePlan =
  | {
      readonly kind: 'toGroup';
      readonly groupId: string;
      /** The group expense to write; its id is new. */
      readonly write: ReturnType<typeof toGroupWrite>;
      readonly next: SavedState;
    }
  | {
      readonly kind: 'toPersonal';
      readonly recordId: string;
      readonly data: Record<string, unknown>;
      readonly next: SavedState;
    };

/**
 * What it takes to move the expense: a new entry in the target ledger (equal
 * split among the target group's members, you paying) and, after it is saved,
 * the removal of the old one. Null when the target is the same, unknown, or has
 * no you in it.
 */
export function planMove(
  state: SavedState,
  target: string | null,
  local: AgentLocalData,
  newId: string,
  /** Who shares the new group entry; default is the whole group. You are always in. */
  participantIds?: readonly string[],
): MovePlan | null {
  if (target === state.groupId) return null;
  if (target === null) {
    const next: SavedState = {
      ...state,
      kind: 'personal',
      id: newId,
      groupId: null,
      payers: null,
      participants: [],
      location: null,
      hasReceipt: false,
      reimbursable: false,
      paymentMethod: state.paymentMethod === 'forex' ? null : state.paymentMethod,
      notes: null,
    };
    return { kind: 'toPersonal', recordId: newId, data: toPersonalData(next), next };
  }
  const group = local.groups.find((g) => g.id === target);
  const me = group?.members.find((m) => m.isViewer);
  if (!group || !me || group.members.length === 0) return null;
  const participants = participantIds
    ? [
        ...new Set([
          me.id,
          ...participantIds.filter((id) => group.members.some((m) => m.id === id)),
        ]),
      ]
    : group.members.map((m) => m.id);
  const shares = computeShares({
    amount: state.amount,
    currency: state.currency,
    params: { kind: 'equal' },
    participants,
    seed: newId,
  });
  const base: AgentExpenseWrite = {
    expenseId: newId,
    description: state.description,
    category: state.category,
    expenseDate: state.date,
    currency: state.currency,
    amount: state.amount,
    splitParams: { kind: 'equal' },
    participants,
    payers: { [me.id]: state.amount },
    expectedShares: Object.fromEntries(shares),
  };
  const notes = state.notes ?? (state.reimbursable ? 'Work expense' : null);
  const next: SavedState = {
    ...state,
    kind: 'group',
    id: newId,
    groupId: target,
    payers: base.payers,
    participants,
    notes,
    reimbursable: false,
    paymentMethod: toGroupPayment(state.paymentMethod) ? state.paymentMethod : null,
  };
  return { kind: 'toGroup', groupId: target, write: toGroupWrite(base, next), next };
}

/* ───────────────────────────── local answer matchers ───────────────────────────── */

const PAYMENT_WORDS: readonly (readonly [RegExp, 'upi' | 'cash' | 'card' | 'credit' | 'debit'])[] =
  [
    [/^(?:by |via |with |through )?(?:upi|gpay|google pay|phonepe|phone pe|paytm|bhim)$/i, 'upi'],
    [/^(?:by |in |with )?cash$/i, 'cash'],
    [/^(?:by |with |on )?(?:a )?credit(?: card)?$/i, 'credit'],
    [/^(?:by |with |on )?(?:a )?debit(?: card)?$/i, 'debit'],
    [/^(?:by |with |on )?(?:a )?card$/i, 'card'],
  ];

export interface LocalMatchContext {
  /** Places this person has been recorded at, most recent first. */
  readonly places: readonly string[];
  readonly placeCoords?: Readonly<Record<string, { lat: number; lng: number }>>;
  /** Category ids, and what each is called on screen. */
  readonly categories: readonly string[];
  readonly categoryLabel: (id: string) => string;
}

const key = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A short typed answer that names a payment method, a category or a place already
 * known, as the answer it is. Null for anything else (it goes to the agent).
 */
export function matchLocalAnswer(
  rawText: string,
  state: SavedState,
  ctx: LocalMatchContext,
): FollowUpAnswer | null {
  const text = rawText.trim().replace(/[.!]+$/, '');
  if (!text || text.split(/\s+/).length > 4) return null;

  const allowed = paymentChoices(state.kind);
  for (const [pattern, method] of PAYMENT_WORDS) {
    if (!pattern.test(text)) continue;
    // A group has credit/debit, a personal entry has card; map to what this one keeps.
    const mapped = method === 'card' && !allowed.includes('card') ? 'credit' : method;
    const final = allowed.includes(mapped)
      ? mapped
      : mapped === 'credit' || mapped === 'debit'
        ? 'card'
        : mapped;
    if (allowed.includes(final)) return { kind: 'payment', method: final };
  }

  const wanted = key(text);
  for (const id of ctx.categories) {
    if (key(id) === wanted || key(ctx.categoryLabel(id)) === wanted) {
      return { kind: 'category', category: id };
    }
  }

  const exact = ctx.places.find((place) => key(place) === wanted);
  const prefix =
    exact ??
    (wanted.length >= 4
      ? (() => {
          const hits = ctx.places.filter((place) => key(place).startsWith(`${wanted} `));
          return hits.length === 1 ? hits[0] : undefined;
        })()
      : undefined);
  if (prefix) {
    const coords = ctx.placeCoords?.[prefix];
    return { kind: 'place', name: prefix, ...(coords ? { coords } : {}) };
  }
  return null;
}

/* ───────────────────────────── the typed-message flow ───────────────────────────── */

export interface TypedContext extends LocalMatchContext {
  readonly text: string;
  readonly state: SavedState;
  readonly today: string;
  readonly locale: string;
  readonly local: AgentLocalData;
  readonly strings: CorrectionStrings;
  readonly online: boolean;
  /**
   * An id for the new entry of a move to `target` (a group id, or null for
   * Personal). It must be STABLE for the same source and target until the move
   * completes, so a retry after a half-done move reuses the entry already written.
   */
  readonly newId: (target: string | null) => string;
  /** The question on screen, so a bare "at Taj" is read as its answer. */
  readonly question?: string;
}

export interface TypedDeps {
  /** Write the new state in place. */
  persist(next: SavedState): Promise<boolean>;
  /** Save the new entry in the other ledger, then remove the old one. */
  move(plan: MovePlan, from: SavedState): Promise<boolean>;
  /** One follow-up turn to the agent. */
  send(text: string): Promise<VoiceAgentResult>;
}

export type TypedResult =
  | {
      readonly kind: 'corrected';
      readonly previous: SavedState;
      readonly next: SavedState;
      readonly line: string;
      readonly fields: readonly CorrectionField[];
      readonly path: 'device' | 'llm';
      /** The old entry is gone and `next` has a new id (a move). */
      readonly moved: boolean;
      /** Other answers that came with the correction (a move AND "paid cash"). */
      readonly answers?: readonly FollowUpAnswer[];
    }
  | {
      readonly kind: 'answered';
      readonly previous: SavedState;
      readonly next: SavedState;
      readonly answers: readonly FollowUpAnswer[];
      readonly path: 'device' | 'llm';
    }
  | { readonly kind: 'undo'; readonly path: 'device' | 'llm' }
  | { readonly kind: 'undoAnswer' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'unusable' };

async function commit(
  ctx: TypedContext,
  deps: TypedDeps,
  fields: CorrectionFields,
  target: { move: boolean; groupId: string | null },
  path: 'device' | 'llm',
): Promise<TypedResult> {
  const applied = applyCorrectionFields(ctx.state, fields);
  if (target.move) {
    const plan = planMove(applied, target.groupId, ctx.local, ctx.newId(target.groupId));
    if (!plan) return { kind: 'unchanged' };
    if (!(await deps.move(plan, applied))) return { kind: 'failed' };
    // Moving re-seats the payer and the split by itself; only what was asked is named.
    const extra = changedFields(ctx.state, applied).filter(
      (f) => f !== 'groupId' && f !== 'payerMemberId',
    );
    const all: CorrectionField[] = [...extra, 'groupId'];
    return {
      kind: 'corrected',
      previous: ctx.state,
      next: plan.next,
      line: correctionLine(plan.next, all, ctx),
      fields: all,
      path,
      moved: true,
    };
  }
  const changed = changedFields(ctx.state, applied);
  if (changed.length === 0) return { kind: 'unchanged' };
  if (!(await deps.persist(applied))) return { kind: 'failed' };
  return {
    kind: 'corrected',
    previous: ctx.state,
    next: applied,
    line: correctionLine(applied, changed, ctx),
    fields: changed,
    path,
    moved: false,
  };
}

/** The agent's `update_expense` fields as correction fields (amount arrives as minor-unit text). */
export function fieldsFromUpdate(update: VoiceExpenseUpdate): CorrectionFields {
  let amountMinor: bigint | undefined;
  if (update.amountMinor && /^[0-9]{1,15}$/.test(update.amountMinor)) {
    amountMinor = BigInt(update.amountMinor);
  }
  return {
    ...(amountMinor && amountMinor > 0n ? { amountMinor } : {}),
    ...(update.date ? { date: update.date } : {}),
    ...(update.description ? { description: update.description } : {}),
    ...(update.currency ? { currency: update.currency } : {}),
  };
}

/** What the phone alone can make of a typed or spoken message about the saved expense. */
export type LocalReading =
  | { readonly kind: 'undo' }
  | { readonly kind: 'undoAnswer' }
  | { readonly kind: 'fields'; readonly fields: CorrectionFields }
  | { readonly kind: 'answer'; readonly answer: FollowUpAnswer };

export function readLocally(
  ctx: Pick<TypedContext, 'text' | 'state' | 'today' | 'locale' | 'local'> & LocalMatchContext,
): LocalReading | null {
  const members = ctx.local.groups.find((g) => g.id === ctx.state.groupId)?.members ?? [];
  const parsed = parseCorrection(
    ctx.text,
    { kind: ctx.state.kind, groupId: ctx.state.groupId, currency: ctx.state.currency },
    {
      today: ctx.today,
      locale: ctx.locale,
      groups: ctx.local.groups.map((g) => ({ id: g.id, name: g.name })),
      members: members.map((m) => ({ id: m.id, name: m.name, isMe: m.isViewer })),
    },
  );
  if (parsed?.kind === 'undo') return { kind: 'undo' };
  if (parsed?.kind === 'undoAnswer') return { kind: 'undoAnswer' };
  if (parsed?.kind === 'update') return { kind: 'fields', fields: parsed.fields };
  const answer = matchLocalAnswer(ctx.text, ctx.state, ctx);
  return answer ? { kind: 'answer', answer } : null;
}

/**
 * One typed or spoken message about the expense just saved. Corrections and
 * simple answers are settled on the phone; the rest is one agent turn.
 */
export async function runTypedMessage(ctx: TypedContext, deps: TypedDeps): Promise<TypedResult> {
  const reading = readLocally(ctx);
  if (reading?.kind === 'undo') return { kind: 'undo', path: 'device' };
  if (reading?.kind === 'undoAnswer') return { kind: 'undoAnswer' };
  if (reading?.kind === 'fields') {
    return commit(
      ctx,
      deps,
      reading.fields,
      { move: 'groupId' in reading.fields, groupId: reading.fields.groupId ?? null },
      'device',
    );
  }
  if (reading?.kind === 'answer') {
    const next = applyAnswer(ctx.state, reading.answer);
    if (next === ctx.state) return { kind: 'unchanged' };
    if (!(await deps.persist(next))) return { kind: 'failed' };
    return {
      kind: 'answered',
      previous: ctx.state,
      next,
      answers: [reading.answer],
      path: 'device',
    };
  }

  if (!ctx.online) return { kind: 'offline' };
  const result = await deps.send(ctx.text);
  if (result.kind !== 'ok') return { kind: 'unusable' };
  return applyAgentResponse(ctx, deps, result.response);
}

/**
 * What the agent's reply asks of the saved expense: a delete, or an update whose
 * fields, move and answers are applied through the same writes a typed
 * correction uses. Shared by the saved bar and the follow-up composer, so a
 * reply is treated the same wherever it was asked for.
 */
export async function applyAgentResponse(
  ctx: TypedContext,
  deps: TypedDeps,
  response: VoiceAgentResponse,
): Promise<TypedResult> {
  if (response.delete && response.delete.expenseId === ctx.state.id) {
    return { kind: 'undo', path: 'llm' };
  }
  const update = response.update;
  if (!update || update.expenseId !== ctx.state.id) return { kind: 'unusable' };

  const fields = fieldsFromUpdate(update);
  const plan = planUpdate(update, ctx.state);
  const hasFields = correctionFieldNames(fields).length > 0;
  const moves = update.groupId !== undefined;
  let working = ctx.state;
  let committed: Extract<TypedResult, { kind: 'corrected' }> | null = null;
  if (hasFields || moves) {
    const outcome = await commit(
      ctx,
      deps,
      fields,
      { move: moves, groupId: update.groupId ?? null },
      'llm',
    );
    if (outcome.kind !== 'corrected') {
      if (plan.answers.length === 0) return outcome;
    } else if (plan.answers.length === 0) {
      return outcome;
    } else {
      working = outcome.next;
      committed = outcome;
    }
  }
  const sharing =
    update.participants && working.kind === 'group'
      ? update.participants.filter((id) =>
          (ctx.local.groups.find((g) => g.id === working.groupId)?.members ?? []).some(
            (m) => m.id === id,
          ),
        )
      : [];
  if (plan.answers.length > 0 || sharing.length > 0) {
    let next = working;
    for (const answer of plan.answers) next = applyAnswer(next, answer);
    if (sharing.length > 0) next = { ...next, participants: sharing };
    if (next !== working) {
      const saved = await deps.persist(next);
      const movedOutcome = committed?.moved ? committed : null;
      if (movedOutcome) {
        // The move already happened and the old entry is gone: it must stay
        // undoable, with the source snapshot, so report it even when the extra
        // answer could not be saved.
        if (!saved) return movedOutcome;
        return { ...movedOutcome, next, answers: plan.answers };
      }
      if (!saved) return { kind: 'failed' };
      return { kind: 'answered', previous: ctx.state, next, answers: plan.answers, path: 'llm' };
    }
  }
  return committed ?? { kind: 'unusable' };
}

/**
 * Follow-up questions are for one expense at a time. When several are confirmed
 * together there is no single expense to ask about, so none is asked (P0).
 */
export function followUpsAllowed(
  cards: readonly { readonly action: { readonly type: string } }[],
): boolean {
  const [only] = cards;
  return (
    cards.length === 1 &&
    only !== undefined &&
    (only.action.type === 'add_expense' || only.action.type === 'add_personal')
  );
}
