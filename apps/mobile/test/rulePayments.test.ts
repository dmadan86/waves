import { describe, expect, it } from 'vitest';

import type { PersonalTxn } from '@waves/core';

import { rulePayments } from '../src/lib/recurringList';

const rule = { id: 'r1', txnKind: 'expense', note: 'Netflix', amount: 500n } as const;
const txn = (over: Partial<PersonalTxn>): PersonalTxn =>
  ({
    id: 'x',
    kind: 'expense',
    amount: 500n,
    note: 'Netflix',
    date: '2026-03-01',
    recurringId: null,
    ...over,
  }) as PersonalTxn;

describe('rulePayments', () => {
  it('counts linked posts and old look-alikes, this year only for the total', () => {
    const out = rulePayments(
      rule,
      [
        txn({ recurringId: 'r1' }),
        txn({ date: '2025-12-01', recurringId: 'r1' }),
        txn({ note: ' netflix ' }),
        txn({ recurringId: 'other' }),
        txn({ amount: 1n }),
      ],
      '2026-06-01',
    );
    expect(out).toEqual({ count: 3, yearCount: 2, yearTotal: 1000n });
  });
});
