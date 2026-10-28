import { describe, expect, it } from 'vitest';

import { MutationKind, type MutationEnvelope } from '../src/sync/protocol';
import { companyEntryFromRefusedExpense } from '../src/sync/refusalConvert';

const expense = (over: Record<string, unknown> = {}): MutationEnvelope => ({
  clientMutationId: 'm1',
  kind: MutationKind.ExpenseCreate,
  groupId: 'g1',
  clientCreatedAt: '2026-10-28T10:00:00Z',
  payload: {
    expenseId: 'e1',
    description: 'Diesel',
    category: 'fuel',
    expenseDate: '2026-10-28',
    currency: 'INR',
    amount: '50000',
    payers: { me: '50000' },
    participants: ['me', 'other'],
    ...over,
  },
});

describe('companyEntryFromRefusedExpense', () => {
  it("turns a single-payer expense into that payer's company expense", () => {
    const out = companyEntryFromRefusedExpense(expense(), 'INR')!;
    expect(out.kind).toBe(MutationKind.CompanyEntryCreate);
    expect(out.clientMutationId).toBe('m1:company');
    expect(out.payload).toMatchObject({
      entryId: 'e1',
      memberId: 'me',
      entryKind: 'expense',
      data: { amount: '50000', category: 'fuel', occurredOn: '2026-10-28', note: 'Diesel' },
    });
  });
  it('preserves custom tag keys', () => {
    const out = companyEntryFromRefusedExpense(expense({ category: 'sushi' }), 'INR')!;
    expect((out.payload as { data: { category: unknown } }).data.category).toBe('sushi');
  });
  it('leaves the unclear cases for a person', () => {
    expect(companyEntryFromRefusedExpense(expense(), 'USD')).toBeNull();
    expect(
      companyEntryFromRefusedExpense(expense({ payers: { a: '1', b: '2' } }), 'INR'),
    ).toBeNull();
    expect(
      companyEntryFromRefusedExpense({ ...expense(), kind: MutationKind.ExpenseUpdate }, 'INR'),
    ).toBeNull();
  });
});

it('drops malformed company tag keys during refusal conversion', () => {
  const out = companyEntryFromRefusedExpense(expense({ category: 'Bad key!' }), 'INR')!;
  expect((out.payload as { data: { category: unknown } }).data.category).toBeNull();
});
