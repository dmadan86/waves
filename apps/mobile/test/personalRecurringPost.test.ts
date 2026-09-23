/**
 * Auto-posting recurring rules never overwrite what somebody entered by hand.
 *
 * `postDueRecurring` runs every time the Me tab opens. Rent is due on the 5th;
 * somebody recorded it on the 7th, at ₹24,000 instead of the rule's ₹25,000,
 * against that month's occurrence. Matching on the *date* would find nothing on
 * the 5th, mint the occurrence at the rule's amount under the same id, and
 * silently overwrite their figure. Matching on the occurrence *id* leaves it
 * alone and only moves the rule on.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decodeRecurring,
  decodeTxn,
  recurringOccurrenceId,
  type PersonalRecurring,
  type PersonalTxn,
} from '@waves/core';

// The module also exports hooks; keep their native and React-context imports
// out of a pure test of the catch-up function.
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: null }) }));
vi.mock('@/sync', () => ({ useSync: () => ({ mutate: vi.fn() }) }));

const { postDueRecurring } = await import('@/data/personal');
type UpsertInput = Parameters<Parameters<typeof postDueRecurring>[2]>[0];

const RENT: PersonalRecurring = {
  id: 'rule-rent',
  txnKind: 'expense',
  amount: 2_500_000n,
  currency: 'INR' as PersonalRecurring['currency'],
  category: 'rent',
  note: 'Rent',
  cadence: 'monthly',
  interval: 1,
  secondDay: null,
  anchorDate: '2026-09-05',
  nextDate: '2026-09-05',
  endDate: null,
  autoPost: true,
  active: true,
};

/** Paid on the 7th, for ₹24,000, against the occurrence due on the 5th. */
const HAND_ENTERED: PersonalTxn = {
  id: recurringOccurrenceId(RENT.id, '2026-09-05'),
  kind: 'expense',
  amount: 2_400_000n,
  currency: 'INR' as PersonalTxn['currency'],
  category: 'rent',
  note: 'Paid late, landlord knocked 1k off',
  date: '2026-09-07',
  loanId: null,
  recurringId: RENT.id,
};

const ledger = (txns: PersonalTxn[], recurrings: PersonalRecurring[] = [RENT]) => ({
  txns,
  recurrings,
  loans: [],
  budgets: [],
});

let writes: UpsertInput[];
const upsert = vi.fn(async (input: UpsertInput): Promise<string> => {
  writes.push(input);
  return input.recordId ?? 'minted-id';
});

beforeEach(() => {
  writes = [];
  upsert.mockClear();
});

describe('postDueRecurring', () => {
  it('leaves a hand-entered occurrence untouched and only advances nextDate', async () => {
    const posted = await postDueRecurring(ledger([HAND_ENTERED]), '2026-09-10', upsert);

    expect(posted).toBe(0);
    // Nothing is written under the occurrence's id — the ₹24,000 stands.
    expect(writes.some((write) => write.recordId === HAND_ENTERED.id)).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.recordId).toBe(RENT.id);
    expect(writes[0]?.recordKind).toBe('recurring');
    const rule = decodeRecurring(RENT.id, writes[0]!.data);
    expect(rule.nextDate).toBe('2026-10-05');
    expect(rule.amount).toBe(RENT.amount);
  });

  it('posts a missing occurrence at the rule amount under its deterministic id', async () => {
    const posted = await postDueRecurring(ledger([]), '2026-09-10', upsert);

    expect(posted).toBe(1);
    const txn = writes.find((write) => write.recordKind === 'txn')!;
    expect(txn.recordId).toBe(recurringOccurrenceId(RENT.id, '2026-09-05'));
    const decoded = decodeTxn(txn.recordId ?? '', txn.data);
    expect(decoded.amount).toBe(2_500_000n);
    expect(decoded.date).toBe('2026-09-05');
    expect(decoded.recurringId).toBe(RENT.id);
    expect(decodeRecurring(RENT.id, writes.at(-1)!.data).nextDate).toBe('2026-10-05');
  });

  it('writes nothing for a rule that is not due, or not set to auto-post', async () => {
    const manual = { ...RENT, id: 'rule-manual', autoPost: false };
    const paused = { ...RENT, id: 'rule-paused', active: false };
    const posted = await postDueRecurring(
      ledger([], [{ ...RENT, nextDate: '2026-10-05' }, manual, paused]),
      '2026-09-10',
      upsert,
    );

    expect(posted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
