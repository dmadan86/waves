import { describe, expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseExpenses,
  MutationKind,
  type ExpenseCreatePayload,
  type QueuedMutation,
} from '../src/index.js';

const GROUP = 'trip';

function payload(extra: Partial<ExpenseCreatePayload> = {}): ExpenseCreatePayload {
  return {
    expenseId: 'e-cab',
    description: 'Cab',
    expenseDate: '2026-10-01',
    currency: 'INR',
    amount: '50000',
    splitParams: { kind: 'equal' },
    participants: ['m-a', 'm-b'],
    payers: { 'm-a': '50000' },
    ...extra,
  } as unknown as ExpenseCreatePayload;
}

function queue(...payloads: ExpenseCreatePayload[]): QueuedMutation[] {
  return payloads.reduce<QueuedMutation[]>(
    (q, p, i) =>
      enqueue(q, {
        clientMutationId: `cm-${i}`,
        kind: i === 0 ? MutationKind.ExpenseCreate : MutationKind.ExpenseUpdate,
        groupId: GROUP,
        clientCreatedAt: `2026-10-01T00:00:0${i}.000Z`,
        payload: p,
      }),
    [],
  );
}

const opts = { groupId: GROUP };

describe('a queued expense keeps its work tag', () => {
  it('shows the flag on the pending version', () => {
    const [expense] = materialiseExpenses(
      emptyMirror(),
      queue(payload({ reimbursable: true })),
      opts,
    );
    expect(expense?.currentVersion?.reimbursable).toBe(true);
  });

  it('is false when the create never said', () => {
    const [expense] = materialiseExpenses(emptyMirror(), queue(payload()), opts);
    expect(expense?.currentVersion?.reimbursable).toBe(false);
  });

  it('carries it through a queued edit that does not mention it', () => {
    const [expense] = materialiseExpenses(
      emptyMirror(),
      queue(payload({ reimbursable: true }), payload({ description: 'Cab (airport)' })),
      opts,
    );
    expect(expense?.currentVersion?.reimbursable).toBe(true);
  });

  it('lets a queued edit switch it off on purpose', () => {
    const [expense] = materialiseExpenses(
      emptyMirror(),
      queue(payload({ reimbursable: true }), payload({ reimbursable: false })),
      opts,
    );
    expect(expense?.currentVersion?.reimbursable).toBe(false);
  });
});
