import { describe, expect, it, vi } from 'vitest';

import {
  applyCorrectionFields,
  fieldsFromUpdate,
  followUpsAllowed,
  matchLocalAnswer,
  type MovePlan,
  planMove,
  runTypedMessage,
  type CorrectionStrings,
  type TypedContext,
  type TypedDeps,
} from '@/lib/assistantCorrections';
import { rescaleWrite } from '@/lib/assistantRescale';
import { historyEntryFor } from '@/lib/assistantUndo';
import type { SavedState } from '@/lib/followUpApply';
import type { AgentExpenseWrite, AgentLocalData } from '@/lib/voiceAgentPlan';
import type { VoiceAgentResponse } from '@waves/core';
import type { VoiceAgentResult } from '@/lib/voiceAgentPure';

const strings: CorrectionStrings = {
  changedAmount: 'Changed to {amount}',
  changedDate: 'Dated {date}',
  changedName: 'Renamed to {name}',
  changedCurrency: 'Now in {currency}',
  changedGroup: 'Moved to {where}',
  changedPayer: '{name} paid',
  personalName: 'Personal',
};

const local: AgentLocalData = {
  groups: [
    {
      id: 'g-goa',
      name: 'Goa trip',
      currency: 'INR',
      members: [
        { id: 'm-me', name: 'Madan', isViewer: true },
        { id: 'm-ravi', name: 'Ravi', isViewer: false },
        { id: 'm-anu', name: 'Anu', isViewer: false },
      ],
    },
    {
      id: 'g-home',
      name: 'Flat 4B',
      currency: 'INR',
      members: [
        { id: 'h-me', name: 'Madan', isViewer: true },
        { id: 'h-sam', name: 'Sam', isViewer: false },
      ],
    },
  ],
};

const personal = (over: Partial<SavedState> = {}): SavedState => ({
  kind: 'personal',
  id: 'p1',
  groupId: null,
  description: 'Lunch',
  amount: 800000n,
  currency: 'INR',
  category: 'food',
  categoryStated: false,
  date: '2026-10-19',
  notes: null,
  place: null,
  location: null,
  paymentMethod: null,
  payers: null,
  hasReceipt: false,
  reimbursable: false,
  participants: [],
  ...over,
});

const group = (over: Partial<SavedState> = {}): SavedState =>
  personal({
    kind: 'group',
    id: 'e1',
    groupId: 'g-goa',
    payers: { 'm-me': 800000n },
    participants: ['m-me', 'm-ravi', 'm-anu'],
    ...over,
  });

function ctxFor(text: string, state: SavedState, over: Partial<TypedContext> = {}): TypedContext {
  return {
    text,
    state,
    today: '2026-10-19',
    locale: 'en-IN',
    local,
    strings,
    online: true,
    newId: () => 'new-id',
    places: ['Blue Tokai Coffee', 'Phoenix Mall'],
    categories: ['food', 'travel', 'shopping'],
    categoryLabel: (id) => id.charAt(0).toUpperCase() + id.slice(1),
    ...over,
  };
}

function depsOf(over: Partial<TypedDeps> = {}) {
  const persist = vi.fn(async (_next: SavedState) => true);
  const move = vi.fn(async (_plan: MovePlan, _from: SavedState) => true);
  const send = vi.fn(async (_text: string): Promise<VoiceAgentResult> => ({ kind: 'error' }));
  return { persist, move, send, deps: { persist, move, send, ...over } as TypedDeps };
}

const okResponse = (extra: Partial<VoiceAgentResponse>): { kind: 'ok'; response: VoiceAgentResponse } => ({
  kind: 'ok',
  response: {
    schemaVersion: 1,
    transcript: '',
    actions: [],
    quota: { used: 1, limit: 100, tier: 'pro' },
    ...extra,
  },
});

describe('typed corrections (MC-CR, CR-25)', () => {
  it('MC-CR-01 typed "make it 800" makes no network call and persists amount 80000', async () => {
    const { deps, persist, send } = depsOf();
    const result = await runTypedMessage(ctxFor('make it 800', personal()), deps);
    expect(send).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
    const saved = persist.mock.calls[0]?.[0];
    expect(saved?.amount).toBe(80000n);
    expect(result.kind).toBe('corrected');
    if (result.kind === 'corrected') {
      expect(result.line).toMatch(/^Changed to .*800.* ✓$/);
      expect(result.path).toBe('device');
      expect(result.fields).toEqual(['amountMinor']);
    }
  });

  it('CR-25 a correction writes through persist and leaves the previous state for history', async () => {
    const before = personal();
    const { deps } = depsOf();
    const result = await runTypedMessage(ctxFor('it was yesterday', before), deps);
    expect(result.kind).toBe('corrected');
    if (result.kind !== 'corrected') return;
    expect(result.previous).toBe(before);
    expect(result.next.date).toBe('2026-10-18');
    const entry = historyEntryFor(result);
    expect(entry).toEqual({ kind: 'edit', previous: before, what: 'correction' });
    expect(result.line).toMatch(/^Dated .* ✓$/);
  });

  it('CR-25b a failed write is reported and nothing is changed', async () => {
    const { deps, persist } = depsOf({ persist: vi.fn(async () => false) });
    const result = await runTypedMessage(ctxFor('make it 800', personal()), deps);
    expect(result.kind).toBe('failed');
    expect(persist).not.toHaveBeenCalled();
  });

  it('CR-25c a correction that changes nothing is "unchanged" and writes nothing', async () => {
    const { deps, persist } = depsOf();
    const result = await runTypedMessage(ctxFor('make it 8000', personal()), deps);
    expect(result.kind).toBe('unchanged');
    expect(persist).not.toHaveBeenCalled();
  });

  it('CR-25d amount and date together are both applied and both named in the line', async () => {
    const { deps } = depsOf();
    const result = await runTypedMessage(ctxFor('make it 500 yesterday', personal()), deps);
    expect(result.kind).toBe('corrected');
    if (result.kind === 'corrected') {
      expect(result.next.amount).toBe(50000n);
      expect(result.next.date).toBe('2026-10-18');
      expect(result.line).toContain(' · ');
    }
  });

  it('CR-25e a currency relabel never converts the amount', async () => {
    const { deps } = depsOf();
    const result = await runTypedMessage(ctxFor('in AED', personal()), deps);
    expect(result.kind).toBe('corrected');
    if (result.kind === 'corrected') {
      expect(result.next.currency).toBe('AED');
      expect(result.next.amount).toBe(800000n);
    }
  });

  it('CR-25f a renamed expense re-guesses the category only when it was not stated', async () => {
    expect(applyCorrectionFields(personal({ categoryStated: true, category: 'travel' }), { description: 'Dinner' }).category).toBe('travel');
    expect(applyCorrectionFields(personal({ category: 'shopping' }), { description: 'Dinner' }).description).toBe('Dinner');
  });

  it('CR-25g undo and "undo the place" are recognised without a network call', async () => {
    const { deps, send } = depsOf();
    expect((await runTypedMessage(ctxFor('undo', personal()), deps)).kind).toBe('undo');
    expect((await runTypedMessage(ctxFor('undo the place', personal()), deps)).kind).toBe('undoAnswer');
    expect(send).not.toHaveBeenCalled();
  });

  it('MC-CR-02 typed "blue tokai" (a recent place) makes no network call and sets the place', async () => {
    const { deps, persist, send } = depsOf();
    const result = await runTypedMessage(ctxFor('blue tokai', personal()), deps);
    expect(send).not.toHaveBeenCalled();
    expect(result.kind).toBe('answered');
    expect(persist.mock.calls[0]?.[0]?.place).toBe('Blue Tokai Coffee');
  });

  it('MC-CR-02b payment words and category names are answered on the phone', async () => {
    const { deps, persist, send } = depsOf();
    await runTypedMessage(ctxFor('gpay', personal()), deps);
    expect(persist.mock.calls[0]?.[0]?.paymentMethod).toBe('upi');
    await runTypedMessage(ctxFor('credit card', group()), deps);
    expect(persist.mock.calls[1]?.[0]?.paymentMethod).toBe('credit');
    await runTypedMessage(ctxFor('travel', personal()), deps);
    expect(persist.mock.calls[2]?.[0]?.category).toBe('travel');
    expect(send).not.toHaveBeenCalled();
  });

  it('MC-CR-03 text the parsers miss goes to the agent', async () => {
    const send = vi.fn(async () => okResponse({ update: { expenseId: 'p1', note: 'with the team' } }));
    const { deps, persist } = depsOf({ send: send as unknown as TypedDeps['send'] });
    const result = await runTypedMessage(ctxFor('it was with the whole team', personal()), deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('it was with the whole team');
    expect(result.kind).toBe('answered');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('MC-CR-03b offline, unread text asks for a connection instead of failing silently', async () => {
    const { deps, send } = depsOf();
    const result = await runTypedMessage(ctxFor('the usual place', personal(), { online: false }), deps);
    expect(result.kind).toBe('offline');
    expect(send).not.toHaveBeenCalled();
  });

  it('MC-CR-03c the agent answering for another expense, or nothing, is unusable', async () => {
    const wrong = vi.fn(async () => okResponse({ update: { expenseId: 'other', note: 'x' } }));
    const empty = vi.fn(async () => okResponse({}));
    const failed = vi.fn(async () => ({ kind: 'quota' as const }));
    for (const send of [wrong, empty, failed]) {
      const { deps } = depsOf({ send: send as unknown as TypedDeps['send'] });
      expect((await runTypedMessage(ctxFor('zzz qqq', personal()), deps)).kind).toBe('unusable');
    }
  });

  it('CR-30 (client) a model correction of the amount applies with no extra work', async () => {
    const send = vi.fn(async () => okResponse({ update: { expenseId: 'p1', amountMinor: '80000' } }));
    const { deps, persist } = depsOf({ send: send as unknown as TypedDeps['send'] });
    const result = await runTypedMessage(ctxFor('the bill was lower than I said', personal({ amount: 900000n })), deps);
    expect(result.kind).toBe('corrected');
    if (result.kind === 'corrected') expect(result.path).toBe('llm');
    expect(persist.mock.calls[0]?.[0]?.amount).toBe(80000n);
  });

  it('CR-30b delete_expense from the agent is an undo, only for the saved id', async () => {
    const mine = vi.fn(async () => okResponse({ remove: { expenseId: 'p1' } }));
    const other = vi.fn(async () => okResponse({ remove: { expenseId: 'zzz' } }));
    const a = depsOf({ send: mine as unknown as TypedDeps['send'] });
    expect(await runTypedMessage(ctxFor('get rid of the thing', personal()), a.deps)).toEqual({ kind: 'undo', path: 'llm' });
    const b = depsOf({ send: other as unknown as TypedDeps['send'] });
    expect((await runTypedMessage(ctxFor('get rid of the thing', personal()), b.deps)).kind).toBe('unusable');
  });

  it('CR-30c fieldsFromUpdate reads only well-formed minor units', () => {
    expect(fieldsFromUpdate({ expenseId: 'x', amountMinor: '80000' }).amountMinor).toBe(80000n);
    for (const bad of ['-1', '1e3', '800.00', '', '0', '9999999999999999']) {
      expect(fieldsFromUpdate({ expenseId: 'x', amountMinor: bad }).amountMinor).toBeUndefined();
    }
  });
});

describe('moving between ledgers', () => {
  it('CR-16m "that was in Flat 4B" saves a new group entry and reports the move', async () => {
    const { deps, move } = depsOf();
    const result = await runTypedMessage(ctxFor('that was in Flat 4B', personal()), deps);
    expect(result.kind).toBe('corrected');
    expect(move).toHaveBeenCalledTimes(1);
    const plan = move.mock.calls[0]?.[0];
    expect(plan?.kind).toBe('toGroup');
    if (plan?.kind === 'toGroup') {
      expect(plan.groupId).toBe('g-home');
      expect(plan.write.expenseId).toBe('new-id');
      expect(plan.write.amount).toBe(800000n);
      expect(plan.write.payers).toEqual({ 'h-me': 800000n });
      expect(plan.write.participants).toEqual(['h-me', 'h-sam']);
      expect(Object.values(plan.write.expectedShares).reduce((a, b) => a + b, 0n)).toBe(800000n);
    }
    if (result.kind === 'corrected') {
      expect(result.moved).toBe(true);
      expect(result.next.groupId).toBe('g-home');
      expect(historyEntryFor(result)?.kind).toBe('move');
      expect(result.line).toBe('Moved to Flat 4B ✓');
    }
  });

  it('CR-18m "put it in personal" turns a group expense into a personal record', async () => {
    const { deps, move } = depsOf();
    const result = await runTypedMessage(ctxFor('put it in personal', group()), deps);
    expect(result.kind).toBe('corrected');
    const plan = move.mock.calls[0]?.[0];
    expect(plan?.kind).toBe('toPersonal');
    if (result.kind === 'corrected') {
      expect(result.next.kind).toBe('personal');
      expect(result.line).toBe('Moved to Personal ✓');
    }
  });

  it('CR-16n a failed move leaves the old entry alone', async () => {
    const { deps } = depsOf({ move: vi.fn(async () => false) });
    expect((await runTypedMessage(ctxFor('move to Flat 4B', personal()), deps)).kind).toBe('failed');
  });

  it('CR-16o a target the caller is not in cannot be planned', () => {
    expect(planMove(personal(), 'g-evil', local, 'n')).toBeNull();
    expect(planMove(group(), 'g-goa', local, 'n')).toBeNull();
  });
});

describe('group amount changes keep the split whole', () => {
  const base: AgentExpenseWrite = {
    expenseId: 'e1',
    description: 'Dinner',
    category: 'food',
    expenseDate: '2026-10-19',
    currency: 'INR',
    amount: 900n,
    splitParams: { kind: 'equal' },
    participants: ['a', 'b', 'c'],
    payers: { a: 900n },
    expectedShares: { a: 300n, b: 300n, c: 300n },
  };
  it('CR-25h equal split is recomputed to the new total and the payer pays all of it', () => {
    const next = rescaleWrite(base, { amount: 1000n, currency: 'INR', description: 'Dinner' });
    expect(next.amount).toBe(1000n);
    expect(Object.values(next.expectedShares).reduce((a, b) => a + b, 0n)).toBe(1000n);
    expect(next.payers).toEqual({ a: 1000n });
  });
  it('CR-25i exact amounts are scaled and still add up', () => {
    const exact: AgentExpenseWrite = {
      ...base,
      splitParams: { kind: 'exact', amounts: { a: 500n, b: 300n, c: 100n } },
      expectedShares: { a: 500n, b: 300n, c: 100n },
    };
    const next = rescaleWrite(exact, { amount: 1800n, currency: 'INR', description: 'Dinner' });
    expect(Object.values(next.expectedShares).reduce((a, b) => a + b, 0n)).toBe(1800n);
  });
  it('CR-25j an unchanged amount returns the same write; a new member set becomes equal', () => {
    expect(rescaleWrite(base, { amount: 900n, currency: 'INR', description: 'Dinner' })).toBe(base);
    const fewer = rescaleWrite(base, { amount: 900n, currency: 'INR', description: 'Dinner', participants: ['a', 'b'] });
    expect(fewer.splitParams).toEqual({ kind: 'equal' });
    expect(Object.keys(fewer.expectedShares).sort()).toEqual(['a', 'b']);
  });
  it('CR-25k correcting a group expense rescales the payer map on the state too', () => {
    const next = applyCorrectionFields(group(), { amountMinor: 100000n });
    expect(next.payers).toEqual({ 'm-me': 100000n });
  });
  it('CR-25l a payer correction makes that member the one who paid it all', () => {
    expect(applyCorrectionFields(group(), { payerMemberId: 'm-ravi' }).payers).toEqual({ 'm-ravi': 800000n });
    expect(applyCorrectionFields(personal(), { payerMemberId: 'm-ravi' }).payers).toBeNull();
  });
});

describe('matchLocalAnswer', () => {
  const ctx = ctxFor('', personal());
  it('does not claim long sentences, unknown places or empty text', () => {
    expect(matchLocalAnswer('we went to blue tokai and then home', personal(), ctx)).toBeNull();
    expect(matchLocalAnswer('somewhere new', personal(), ctx)).toBeNull();
    expect(matchLocalAnswer('', personal(), ctx)).toBeNull();
  });
  it('an unambiguous place prefix matches but a short one does not', () => {
    expect(matchLocalAnswer('phoenix', personal(), ctx)).toEqual({ kind: 'place', name: 'Phoenix Mall' });
    expect(matchLocalAnswer('ph', personal(), ctx)).toBeNull();
  });
  it('a stored place brings its coordinates', () => {
    const withCoords = { ...ctx, placeCoords: { 'Phoenix Mall': { lat: 1, lng: 2 } } };
    expect(matchLocalAnswer('Phoenix Mall', group(), withCoords)).toEqual({
      kind: 'place',
      name: 'Phoenix Mall',
      coords: { lat: 1, lng: 2 },
    });
  });
});

describe('multi-expense rule (CR-29)', () => {
  const add = { action: { type: 'add_personal' } };
  it('CR-29 several confirmed expenses mount no follow-ups', () => {
    expect(followUpsAllowed([add, add])).toBe(false);
    expect(followUpsAllowed([add, { action: { type: 'add_expense' } }])).toBe(false);
  });
  it('CR-29b exactly one add mounts them; a settle-up or nothing does not', () => {
    expect(followUpsAllowed([add])).toBe(true);
    expect(followUpsAllowed([{ action: { type: 'add_expense' } }])).toBe(true);
    expect(followUpsAllowed([{ action: { type: 'record_settlement' } }])).toBe(false);
    expect(followUpsAllowed([])).toBe(false);
  });
});
