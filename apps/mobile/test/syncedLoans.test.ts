/**
 * Sharing a personal loan (LG-* on device). The hooks are thin, so they run as
 * plain functions (`useMutation` stood in for by its options) and the test reads
 * what would be queued: group, person, expense, then the loan's link, in order.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MutationKind, type PersonalLoan } from '@waves/core';

const state = vi.hoisted(() => ({
  calls: [] as { kind: string; scope: string; payload: Record<string, unknown> }[],
  upserts: [] as { recordId?: string; recordKind: string; data: Record<string, unknown> }[],
  deletes: [] as string[],
  groups: new Set<string>(),
  n: 0,
}));

vi.mock('@tanstack/react-query', () => ({ useMutation: (options: unknown) => options }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `id-${++state.n}` }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ profile: { id: 'p1', country_code: 'IN' } }),
  useViewerId: () => 'p1',
}));
vi.mock('@/lib/phone', () => ({ normaliseContactPhone: (phone: string) => `+91${phone}` }));
vi.mock('@/sync', () => ({
  useSync: () => ({
    mutate: async (kind: string, scope: string, payload: Record<string, unknown>) => {
      state.calls.push({ kind, scope, payload });
    },
  }),
}));
vi.mock('@/data/hooks', () => ({
  useSyncedLoanNets: () => ({ nets: new Map(), groups: state.groups }),
}));
vi.mock('@/data/personal', () => ({
  useUpsertPersonalRecord: () => ({
    mutateAsync: async (input: (typeof state.upserts)[number]) => {
      state.upserts.push(input);
      return input.recordId ?? 'new';
    },
  }),
  useDeletePersonalRecord: () => ({
    mutateAsync: async (id: string) => {
      state.deletes.push(id);
    },
  }),
}));

const { useShareLoan, useUnshareLoan, ShareLoanError } = await import('@/data/syncedLoans');

type Opts<I, O> = { mutationFn: (input: I) => Promise<O> };

const LOAN: PersonalLoan = {
  id: 'L1',
  direction: 'lent',
  counterpart: 'ravi',
  principal: 500000n,
  currency: 'INR',
  note: 'deposit',
  startDate: '2026-10-19',
  status: 'active',
  synced: null,
};

beforeEach(() => {
  state.calls = [];
  state.upserts = [];
  state.deletes = [];
  state.groups = new Set();
  state.n = 0;
});

describe('useShareLoan', () => {
  it('LG-01 creates the 1:1 group, the person and the lender-paid expense, then links the loan', async () => {
    const share = useShareLoan([LOAN]) as unknown as Opts<
      { loan: PersonalLoan; person?: { name: string; phone?: string } },
      unknown
    >;
    const link = await share.mutationFn({ loan: LOAN, person: { name: 'ravi', phone: '98' } });

    expect(state.calls.map((call) => call.kind)).toEqual([
      MutationKind.GroupCreate,
      MutationKind.MemberAddGhost,
      MutationKind.ExpenseCreate,
    ]);
    const [group, ghost, expense] = state.calls;
    expect(group?.payload).toMatchObject({ name: 'Ravi', currency: 'INR', creatorProfileId: 'p1' });
    expect(ghost?.payload).toMatchObject({ name: 'Ravi', phone: '+9198' });
    const me = (link as { myMemberId: string }).myMemberId;
    const other = (link as { otherMemberId: string }).otherMemberId;
    expect(expense?.payload).toMatchObject({
      amount: '500000',
      payers: { [me]: '500000' },
      participants: [me, other],
      expenseId: (link as { expenseId: string }).expenseId,
    });
    // The loan is written last and carries the link, with the cleaned name.
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]?.recordId).toBe('L1');
    expect(state.upserts[0]?.data.synced).toEqual(link);
    expect(state.upserts[0]?.data.counterpart).toBe('Ravi');
  });

  it('LG-06 a second loan to the same person goes into the same group', async () => {
    const first: PersonalLoan = {
      ...LOAN,
      id: 'L0',
      counterpart: 'Ravi',
      synced: { groupId: 'g9', expenseId: 'e0', myMemberId: 'a', otherMemberId: 'b' },
    };
    state.groups = new Set(['g9']);
    const share = useShareLoan([first, LOAN]) as unknown as Opts<{ loan: PersonalLoan }, unknown>;
    const link = (await share.mutationFn({ loan: LOAN })) as { groupId: string; expenseId: string };

    expect(state.calls.map((call) => call.kind)).toEqual([MutationKind.ExpenseCreate]);
    expect(link.groupId).toBe('g9');
    expect(link.expenseId).not.toBe('e0');
    expect(state.calls[0]?.scope).toBe('g9');
  });

  it('LG-12 refuses a loan that is already shared, or has no amount', async () => {
    const share = useShareLoan([]) as unknown as Opts<{ loan: PersonalLoan }, unknown>;
    const linked = {
      ...LOAN,
      synced: { groupId: 'g', expenseId: 'e', myMemberId: 'a', otherMemberId: 'b' },
    };
    await expect(share.mutationFn({ loan: linked })).rejects.toBeInstanceOf(ShareLoanError);
    await expect(share.mutationFn({ loan: { ...LOAN, principal: 0n } })).rejects.toThrow(
      'LOAN_NOT_SHAREABLE: no-amount',
    );
    expect(state.calls).toEqual([]);
    expect(state.upserts).toEqual([]);
  });
});

describe('useUnshareLoan', () => {
  it('deletes the group expense, then keeps the loan private', async () => {
    const synced = { groupId: 'g1', expenseId: 'e1', myMemberId: 'a', otherMemberId: 'b' };
    const unshare = useUnshareLoan() as unknown as Opts<PersonalLoan, void>;
    await unshare.mutationFn({ ...LOAN, synced });
    expect(state.calls).toEqual([
      { kind: MutationKind.ExpenseDelete, scope: 'g1', payload: { expenseId: 'e1' } },
    ]);
    expect('synced' in (state.upserts[0]?.data ?? {})).toBe(false);
  });

  it('does nothing for a loan that was never shared', async () => {
    const unshare = useUnshareLoan() as unknown as Opts<PersonalLoan, void>;
    await unshare.mutationFn(LOAN);
    expect(state.calls).toEqual([]);
    expect(state.upserts).toEqual([]);
  });
});
