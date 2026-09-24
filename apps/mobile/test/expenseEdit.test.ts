/**
 * `lib/expenseEdit` is the write path the full expense editor and the expense
 * screen's one-field pop-ups share. The pop-ups change one field of the state
 * seeded from a version and hand it to `expenseWritePayload`; the editor does
 * the same with its whole form. These tests pin that a one-field change writes
 * what the editor would have written for that change — and nothing else moves:
 * the note and receipt link ride through, `baseVersionNo` is the version being
 * replaced, and `expectedShares` is seeded with the expense id (ADR-009).
 */

import { describe, expect, it } from 'vitest';
import { computeShares, serialisePayers, type SplitParams } from '@waves/core';

import type { ExpenseVersionRow } from '@/data/types';
import {
  canEditInline,
  editBlocker,
  editStateFromVersion,
  expenseWritePayload,
  lineAmountFor,
  payerIssueFor,
  previewShares,
  splitIssueFor,
  amountEditsInline,
  type ExpenseEditState,
} from '@/lib/expenseEdit';
import { entryValues, exactValues, SplitKind } from '@/lib/split';

const EXPENSE = 'exp-7f3a';
const STRINGS = {
  paidLeftToAssign: '{amount} left to assign',
  paidOverAssigned: '{amount} too much',
  chooseWhoPaid: 'Choose who paid',
  saveNeedsAmount: 'Enter an amount to save',
  saveNeedsWho: 'Pick who’s splitting',
};

function version(overrides: Partial<ExpenseVersionRow> = {}): ExpenseVersionRow {
  return {
    id: 'v-3',
    version_no: 3,
    description: 'Dinner at Saravana',
    category: 'food',
    category_meta: null,
    expense_date: '2026-09-01',
    currency: 'INR',
    amount: '100000',
    split_type: 'equal',
    split_params: { kind: 'equal' },
    author_member_id: 'm-a',
    notes: 'ask Ravi for the tip',
    payment_method: 'upi',
    receipt_share_url: 'https://drive.example/r1',
    receipt_id: 'rcpt-1',
    location: { lat: 13.08, lng: 80.27, name: 'Chennai' },
    fx: null,
    created_at: '2026-09-01T12:00:00Z',
    payers: [{ member_id: 'm-a', amount: '100000' }],
    shares: [
      { member_id: 'm-a', amount: '33334' },
      { member_id: 'm-b', amount: '33333' },
      { member_id: 'm-c', amount: '33333' },
    ],
    ...overrides,
  };
}

/**
 * What the full editor queued before the payload was extracted — its inline
 * `submit` body, transcribed. The extraction must not have changed a field.
 */
function editorPayloadBeforeExtraction(
  expenseId: string,
  state: ExpenseEditState,
  editing: ExpenseVersionRow | null,
): Record<string, unknown> {
  // The editor's old `splitParams` useMemo, transcribed — not `splitParamsFor`,
  // so the reference cannot inherit a bug from the code under test.
  const { splitKind, weights, percents, exacts, participants, currency } = state;
  let splitParams: SplitParams;
  if (splitKind === SplitKind.Shares) {
    splitParams = { kind: 'shares', weights: entryValues('shares', weights, participants) };
  } else if (splitKind === SplitKind.Percent) {
    splitParams = {
      kind: 'percent',
      basisPoints: entryValues('percent', percents, participants),
    };
  } else if (splitKind === SplitKind.Exact) {
    splitParams = { kind: 'exact', amounts: exactValues(exacts, participants, currency) };
  } else {
    splitParams = { kind: 'equal' };
  }
  let preview: Map<string, bigint> | null = null;
  if (state.participants.length > 0 && state.amount !== 0n) {
    try {
      preview = computeShares({
        amount: state.amount,
        currency: state.currency,
        params: splitParams,
        participants: state.participants,
        seed: expenseId,
      });
    } catch {
      preview = null;
    }
  }
  return {
    expenseId,
    description: state.description.trim(),
    category: state.category,
    categoryMeta: state.categoryMeta,
    expenseDate: state.expenseDate,
    currency: state.currency,
    amount: state.amount.toString(),
    fx: state.fx,
    splitParams,
    participants: state.participants,
    payers: serialisePayers(state.payers),
    paymentMethod: state.paymentMethod,
    location: state.location,
    notes: editing?.notes ?? undefined,
    receiptId: editing?.receipt_id ?? undefined,
    receiptShareUrl: editing?.receipt_share_url ?? undefined,
    expectedShares: preview
      ? Object.fromEntries([...preview].map(([id, share]) => [id, share.toString()]))
      : undefined,
    baseVersionNo: editing?.version_no ?? null,
  };
}

describe('editStateFromVersion', () => {
  it('opens a saved bill on what it carries', () => {
    const state = editStateFromVersion(version(), 'm-z');
    expect(state.amount).toBe(100000n);
    expect(state.currency).toBe('INR');
    expect(state.expenseDate).toBe('2026-09-01');
    expect(state.paymentMethod).toBe('upi');
    expect(state.location).toEqual({ lat: 13.08, lng: 80.27, name: 'Chennai' });
    expect(state.participants).toEqual(['m-a', 'm-b', 'm-c']);
    expect(state.splitKind).toBe(SplitKind.Equal);
    // The recorded payer, not the fallback.
    expect([...state.payers]).toEqual([['m-a', 100000n]]);
  });

  it('keeps every payer of a several-payer bill', () => {
    const state = editStateFromVersion(
      version({
        payers: [
          { member_id: 'm-a', amount: '60000' },
          { member_id: 'm-b', amount: '40000' },
        ],
      }),
      'm-a',
    );
    expect(Object.fromEntries(state.payers)).toEqual({ 'm-a': 60000n, 'm-b': 40000n });
  });

  it('falls back to the given payer holding the whole bill when none is recorded', () => {
    const state = editStateFromVersion(version({ payers: [] }), 'm-z');
    expect([...state.payers]).toEqual([['m-z', 100000n]]);
  });

  it('puts the typed split figures back in their fields', () => {
    const shares = editStateFromVersion(
      version({ split_type: 'shares', split_params: { kind: 'shares', weights: { 'm-a': 2 } } }),
      null,
    );
    expect(shares.splitKind).toBe(SplitKind.Shares);
    expect(shares.weights).toEqual({ 'm-a': '2' });

    const percent = editStateFromVersion(
      version({
        split_type: 'percent',
        split_params: { kind: 'percent', basisPoints: { 'm-a': 3333, 'm-b': 6667 } },
      }),
      null,
    );
    expect(percent.percents).toEqual({ 'm-a': '33.33', 'm-b': '66.67' });

    const exact = editStateFromVersion(
      version({
        split_type: 'exact',
        split_params: { kind: 'exact', amounts: { 'm-a': 25050n, 'm-b': 74950n } },
      }),
      null,
    );
    expect(exact.splitKind).toBe(SplitKind.Exact);
    expect(exact.exacts).toEqual({ 'm-a': '250.50', 'm-b': '749.50' });
  });
});

describe('expenseWritePayload', () => {
  const FX = {
    num: '9000',
    den: '100',
    from: 'EUR' as const,
    to: 'INR' as const,
    ts: '2026-09-01T00:00:00Z',
    source: 'manual',
  };
  const PARITY_CASES: { name: string; saved: ExpenseVersionRow }[] = [
    { name: 'equal, one payer', saved: version() },
    {
      name: 'shares',
      saved: version({
        split_type: 'shares',
        split_params: { kind: 'shares', weights: { 'm-a': 2, 'm-b': 1, 'm-c': 1 } },
      }),
    },
    {
      name: 'percent',
      saved: version({
        split_type: 'percent',
        split_params: { kind: 'percent', basisPoints: { 'm-a': 3333, 'm-b': 3333, 'm-c': 3334 } },
      }),
    },
    {
      name: 'exact',
      saved: version({
        split_type: 'exact',
        split_params: {
          kind: 'exact',
          amounts: { 'm-a': 50000n, 'm-b': 25050n, 'm-c': 24950n },
        },
      }),
    },
    {
      name: 'several payers',
      saved: version({
        payers: [
          { member_id: 'm-b', amount: '40000' },
          { member_id: 'm-a', amount: '60000' },
        ],
      }),
    },
    {
      name: 'a foreign bill with its rate',
      saved: version({
        currency: 'EUR',
        amount: '5000',
        fx: FX,
        payers: [{ member_id: 'm-a', amount: '5000' }],
      }),
    },
  ];

  for (const { name, saved } of PARITY_CASES) {
    it(`writes what the editor wrote before the extraction — ${name}`, () => {
      const state = editStateFromVersion(saved, null);
      expect(expenseWritePayload({ expenseId: EXPENSE, state, editing: saved })).toEqual(
        editorPayloadBeforeExtraction(EXPENSE, state, saved),
      );
      // And the same after a change, so the comparison is not only of a no-op.
      const changed = { ...state, description: 'Changed', expenseDate: '2026-08-30' };
      expect(expenseWritePayload({ expenseId: EXPENSE, state: changed, editing: saved })).toEqual(
        editorPayloadBeforeExtraction(EXPENSE, changed, saved),
      );
    });

    it(`writes what the editor wrote before the extraction — ${name}, as a new bill`, () => {
      const state = editStateFromVersion(saved, null);
      const payload = expenseWritePayload({ expenseId: EXPENSE, state, editing: null });
      expect(payload).toEqual(editorPayloadBeforeExtraction(EXPENSE, state, null));
      expect(payload.baseVersionNo).toBeNull();
      expect(payload.notes).toBeUndefined();
      expect(payload.receiptId).toBeUndefined();
    });
  }

  it('carries the note, receipt link and version number through an edit', () => {
    const payload = expenseWritePayload({
      expenseId: EXPENSE,
      state: editStateFromVersion(version(), null),
      editing: version(),
    });
    expect(payload.notes).toBe('ask Ravi for the tip');
    expect(payload.receiptId).toBe('rcpt-1');
    expect(payload.receiptShareUrl).toBe('https://drive.example/r1');
    expect(payload.baseVersionNo).toBe(3);
    expect(payload.payers).toEqual({ 'm-a': '100000' });
  });

  it('seeds expectedShares with the expense id, as the server does', () => {
    const state = editStateFromVersion(version(), null);
    const payload = expenseWritePayload({ expenseId: EXPENSE, state, editing: version() });
    const shares = computeShares({
      amount: 100000n,
      currency: 'INR',
      params: { kind: 'equal' },
      participants: ['m-a', 'm-b', 'm-c'],
      seed: EXPENSE,
    });
    expect(payload.expectedShares).toEqual(
      Object.fromEntries([...shares].map(([id, v]) => [id, v.toString()])),
    );
  });

  it('changing only the date changes only the date', () => {
    const saved = version();
    const before = expenseWritePayload({
      expenseId: EXPENSE,
      state: editStateFromVersion(saved, null),
      editing: saved,
    });
    const after = expenseWritePayload({
      expenseId: EXPENSE,
      state: { ...editStateFromVersion(saved, null), expenseDate: '2026-08-28' },
      editing: saved,
    });
    expect(after).toEqual({ ...before, expenseDate: '2026-08-28' });
  });

  it('changing only the description changes only the description, trimmed', () => {
    const saved = version();
    const before = expenseWritePayload({
      expenseId: EXPENSE,
      state: editStateFromVersion(saved, null),
      editing: saved,
    });
    const after = expenseWritePayload({
      expenseId: EXPENSE,
      state: { ...editStateFromVersion(saved, null), description: '  Lunch at Murugan  ' },
      editing: saved,
    });
    expect(after).toEqual({ ...before, description: 'Lunch at Murugan' });
  });

  it('a blank description stays blank', () => {
    const saved = version();
    const payload = expenseWritePayload({
      expenseId: EXPENSE,
      state: { ...editStateFromVersion(saved, null), description: '   ' },
      editing: saved,
    });
    expect(payload.description).toBe('');
  });

  it('changing the split rewrites the split and its shares, and nothing else', () => {
    const saved = version();
    const base = editStateFromVersion(saved, null);
    const before = expenseWritePayload({ expenseId: EXPENSE, state: base, editing: saved });
    const state: ExpenseEditState = {
      ...base,
      splitKind: SplitKind.Exact,
      participants: ['m-a', 'm-b'],
      exacts: { 'm-a': '700', 'm-b': '300', 'm-c': '5' },
    };
    const after = expenseWritePayload({ expenseId: EXPENSE, state, editing: saved });
    expect(after).toEqual(editorPayloadBeforeExtraction(EXPENSE, state, saved));
    // An unticked person's leftover figure is not written.
    expect(after.splitParams).toEqual({
      kind: 'exact',
      amounts: { 'm-a': 70000n, 'm-b': 30000n },
    });
    expect(after.expectedShares).toEqual({ 'm-a': '70000', 'm-b': '30000' });
    expect(after.participants).toEqual(['m-a', 'm-b']);
    const { splitParams: _a, expectedShares: _b, participants: _c, ...restAfter } = after;
    const { splitParams: _d, expectedShares: _e, participants: _f, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
  });

  it('changing the payer moves the whole bill to them', () => {
    const saved = version();
    const payload = expenseWritePayload({
      expenseId: EXPENSE,
      state: { ...editStateFromVersion(saved, null), payers: new Map([['m-b', 100000n]]) },
      editing: saved,
    });
    expect(payload.payers).toEqual({ 'm-b': '100000' });
  });

  it('keeps a foreign bill in its own currency with its own rate', () => {
    const fx = {
      num: '9000',
      den: '100',
      from: 'EUR' as const,
      to: 'INR' as const,
      ts: '2026-09-01T00:00:00Z',
      source: 'manual',
    };
    const saved = version({
      currency: 'EUR',
      amount: '5000',
      fx,
      payers: [{ member_id: 'm-a', amount: '5000' }],
    });
    const payload = expenseWritePayload({
      expenseId: EXPENSE,
      state: { ...editStateFromVersion(saved, null), expenseDate: '2026-09-02' },
      editing: saved,
    });
    expect(payload.currency).toBe('EUR');
    expect(payload.amount).toBe('5000');
    expect(payload.fx).toEqual(fx);
  });
});

describe('the checks that gate Save', () => {
  it('an untouched bill can be saved', () => {
    expect(editBlocker(editStateFromVersion(version(), null), STRINGS, 'en')).toBeNull();
  });

  it('an exact split that does not add up says by how much', () => {
    const state: ExpenseEditState = {
      ...editStateFromVersion(version(), null),
      splitKind: SplitKind.Exact,
      exacts: { 'm-a': '500', 'm-b': '300', 'm-c': '100' },
    };
    const issue = splitIssueFor(state, STRINGS, 'en');
    expect(issue).toMatch(/left to assign$/);
    expect(issue).toContain('100');
    expect(editBlocker(state, STRINGS, 'en')).toBe(issue);
  });

  it('percentages short of 100 are refused', () => {
    const state: ExpenseEditState = {
      ...editStateFromVersion(version(), null),
      splitKind: SplitKind.Percent,
      percents: { 'm-a': '50', 'm-b': '20', 'm-c': '20' },
    };
    expect(splitIssueFor(state, STRINGS, 'en')).toMatch(/10% left/);
  });

  it('a new total with several recorded payers no longer adds up', () => {
    const state: ExpenseEditState = {
      ...editStateFromVersion(
        version({
          payers: [
            { member_id: 'm-a', amount: '60000' },
            { member_id: 'm-b', amount: '40000' },
          ],
        }),
        null,
      ),
      amount: 120000n,
    };
    expect(payerIssueFor(state, STRINGS, 'en')).toMatch(/left to assign$/);
    expect(editBlocker(state, STRINGS, 'en')).not.toBeNull();
  });

  it('nobody in the split, or no amount, blocks Save', () => {
    const base = editStateFromVersion(version(), null);
    expect(editBlocker({ ...base, participants: [] }, STRINGS, 'en')).toBe(STRINGS.saveNeedsWho);
    expect(editBlocker({ ...base, amount: 0n }, STRINGS, 'en')).toBe(STRINGS.saveNeedsAmount);
  });
});

describe('previews', () => {
  it('previewShares is null until there is something to split', () => {
    const params: SplitParams = { kind: 'equal' };
    expect(
      previewShares({ amount: 0n, currency: 'INR', params, participants: ['m-a'], seed: EXPENSE }),
    ).toBeNull();
    expect(
      previewShares({ amount: 100n, currency: 'INR', params, participants: [], seed: EXPENSE }),
    ).toBeNull();
  });

  it('a short percent line still shows its own share of the total', () => {
    const state = {
      splitKind: SplitKind.Percent,
      percents: { 'm-a': '20' },
      amount: 30000n,
    };
    expect(lineAmountFor('m-a', null, state)).toBe(6000n);
    expect(lineAmountFor('m-a', new Map([['m-a', 123n]]), state)).toBe(123n);
  });
});

describe('canEditInline', () => {
  it('allows the four kinds the editor has controls for', () => {
    expect(canEditInline('equal')).toBe(true);
    expect(canEditInline('shares')).toBe(true);
    expect(canEditInline('percent')).toBe(true);
    expect(canEditInline('exact')).toBe(true);
  });

  it('keeps itemized and adjusted bills read-only, so a pop-up cannot re-split them', () => {
    expect(canEditInline('itemized')).toBe(false);
    expect(canEditInline('adjustment')).toBe(false);
  });
});

describe('amountEditsInline', () => {
  it('a one-payer bill on an equal, shares or percent split takes a new total in place', () => {
    expect(amountEditsInline(version())).toBe(true);
    expect(amountEditsInline(version({ split_type: 'shares' }))).toBe(true);
    expect(amountEditsInline(version({ split_type: 'percent' }))).toBe(true);
  });

  it('an exact split or several payers go to the full editor instead of a dead end', () => {
    expect(amountEditsInline(version({ split_type: 'exact' }))).toBe(false);
    expect(
      amountEditsInline(
        version({
          payers: [
            { member_id: 'm-a', amount: '60000' },
            { member_id: 'm-b', amount: '40000' },
          ],
        }),
      ),
    ).toBe(false);
    expect(amountEditsInline(version({ split_type: 'itemized' }))).toBe(false);
  });
});
