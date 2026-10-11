import { describe, expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseExpenses,
  MutationKind,
  type ExpenseCreatePayload,
  type QueuedMutation,
} from '../src/index.js';

const GROUP = 'home';

function payload(extra: Partial<ExpenseCreatePayload> = {}): ExpenseCreatePayload {
  return {
    expenseId: 'e-rent',
    description: 'Rent',
    expenseDate: '2026-10-01',
    currency: 'INR',
    amount: '2500000',
    splitParams: { kind: 'equal' },
    participants: ['m-a', 'm-b'],
    payers: { 'm-a': '2500000' },
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

describe('a queued expense keeps its "Paid to"', () => {
  it('shows the payee on the pending version, cleaned', () => {
    const [expense] = materialiseExpenses(emptyMirror(), queue(payload({ payee: ' Landlord ' })), {
      groupId: GROUP,
    });
    expect(expense?.currentVersion?.payee).toBe('Landlord');
  });

  it('carries it forward under a queued edit from a build that predates the field', () => {
    const [expense] = materialiseExpenses(
      emptyMirror(),
      queue(payload({ payee: 'Landlord' }), payload({ description: 'Rent (Oct)' })),
      { groupId: GROUP },
    );
    expect(expense?.currentVersion?.description).toBe('Rent (Oct)');
    expect(expense?.currentVersion?.payee).toBe('Landlord');
  });

  it("clears it when the edit sent ''", () => {
    const [expense] = materialiseExpenses(
      emptyMirror(),
      queue(payload({ payee: 'Landlord' }), payload({ payee: '' })),
      { groupId: GROUP },
    );
    expect(expense?.currentVersion?.payee).toBeNull();
  });
});
