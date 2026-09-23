/**
 * The write side of `src/data/hooks.ts`: what each action puts on the queue, or
 * sends to the server.
 *
 * Most writes queue rather than call (ADR-005): the envelope is what reaches
 * the server, possibly hours later, so its kind, scope and payload are the
 * contract being tested — a bigint that is not turned into a decimal string, or
 * a pin written to the group's scope instead of the person's, is a write that
 * syncs wrong. The few that still go straight to an RPC (attachments, comments,
 * proofs, member admin) are checked for the call they make, the cleanup they do
 * when it fails, and the flush or invalidation that follows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MutationKind,
  SyncTable,
  categoryTagsScope,
  groupPinId,
  groupPinsScope,
} from '@waves/core';

import {
  mirrorOf,
  query,
  render,
  resetHarness,
  resetSync,
  sync,
  syncModule,
  type CapturedMutation,
} from './support/hookHarness';

vi.mock('react', async () => {
  const harness = await import('./support/hookHarness');
  return { ...harness.fakeReact, default: harness.fakeReact };
});
vi.mock(
  '@tanstack/react-query',
  async () => (await import('./support/hookHarness')).fakeReactQuery,
);
vi.mock('@/sync', async () => (await import('./support/hookHarness')).fakeSync);
// The data hooks read this device's local SMS drafts; the real store opens
// SQLite and the keystore, so it is the real cache over memory here.
vi.mock('@/lib/smsDraftStore', async () =>
  (await import('./support/memoryDraftStore')).memoryDraftStoreModule(),
);
// `@/lib/phone` reads the device region from here; the real module pulls React Native.
vi.mock('@/i18n', () => ({ deviceCountry: () => null }));

const uuid = vi.hoisted(() => ({ n: 0 }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++uuid.n}` }));

const auth = vi.hoisted(() => ({
  value: { session: null, profile: null } as {
    session: { user: { id: string } } | null;
    profile: { id: string; country_code?: string | null } | null;
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => auth.value }));
vi.mock('@/lib/observability', () => ({ reportHandled: vi.fn() }));

const backend = vi.hoisted(() => ({
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));
vi.mock('@/lib/backend', () => ({ backend }));

const api = vi.hoisted(() => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(() => Promise.resolve()),
  fetchBalances: vi.fn(),
  fetchExpenseVersions: vi.fn(),
  fetchItemClaims: vi.fn(),
  fetchOpenReceipts: vi.fn(),
  fetchReceipt: vi.fn(),
  fetchMemberClaims: vi.fn(),
  decideMemberClaim: vi.fn(() => Promise.resolve({ ok: true })),
  recordSettlement: vi.fn(),
  leaveGroup: vi.fn(() => Promise.resolve()),
  updateGroup: vi.fn(),
  updateMember: vi.fn(() => Promise.resolve()),
  setMemberRole: vi.fn(() => Promise.resolve()),
  removeExpenseReceipt: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/data/api', () => api);

const storage = vi.hoisted(() => ({
  putImage: vi.fn((_input: Record<string, unknown>) => Promise.resolve()),
  removeRestrictedImage: vi.fn((_bucket: string, _subject: string, _path: string) =>
    Promise.resolve(),
  ),
}));
vi.mock('@/lib/storage', () => storage);

const image = vi.hoisted(() => ({ pickAlbumPhoto: vi.fn() }));
vi.mock('@/lib/image', () => image);

const hooks = await import('@/data/hooks');

const OWNER = 'user-me';

/** The single mutate call made, as [kind, scope, payload, clientMutationId?]. */
function onlyMutate(): unknown[] {
  expect(sync.mutate).toHaveBeenCalledTimes(1);
  return sync.mutate.mock.calls[0]!;
}

function mutation<I, O = unknown>(hook: () => unknown): CapturedMutation<I, O> {
  return render(hook) as CapturedMutation<I, O>;
}

/** Let `invalidateGroup`'s flush → invalidate chain run. */
async function settled(): Promise<void> {
  await vi.waitFor(() => expect(query.client.invalidateQueries).toHaveBeenCalled());
}

beforeEach(() => {
  resetHarness();
  resetSync();
  uuid.n = 0;
  auth.value = { session: { user: { id: OWNER } }, profile: { id: 'p-me', country_code: 'IN' } };
  backend.rpc.mockReset();
  backend.rpc.mockResolvedValue({ data: null, error: null });
  storage.putImage.mockClear();
  storage.removeRestrictedImage.mockReset();
  storage.removeRestrictedImage.mockImplementation(() => Promise.resolve());
  image.pickAlbumPhoto.mockReset();
  for (const fn of Object.values(api)) fn.mockClear();
});

describe('groups', () => {
  it('useCreateGroup queues the group under an id chosen here, naming the creator', async () => {
    const create = mutation<Record<string, unknown>, string>(() => hooks.useCreateGroup());
    const id = await create.mutationFn({ name: '  Goa  ', type: 'trip', currency: 'INR' });
    expect(id).toBe('uuid-1');
    expect(onlyMutate()).toEqual([
      MutationKind.GroupCreate,
      'uuid-1',
      {
        name: 'Goa',
        type: 'trip',
        currency: 'INR',
        emoji: null,
        simplify: true,
        photoPath: null,
        country: null,
        creatorMemberId: 'uuid-2',
        creatorProfileId: 'p-me',
      },
    ]);
  });

  it('useCreateGroup keeps ids the caller already chose, and a blank name is no name', async () => {
    auth.value = { session: null, profile: null };
    const create = mutation<Record<string, unknown>, string>(() => hooks.useCreateGroup());
    const id = await create.mutationFn({
      groupId: 'g-mine',
      creatorMemberId: 'm-mine',
      name: '   ',
      type: 'home',
      currency: 'EUR',
      emoji: '🏠',
      simplify: false,
      photoPath: 'p.jpg',
      country: 'FR',
    });
    expect(id).toBe('g-mine');
    expect(onlyMutate()[2]).toMatchObject({
      name: null,
      emoji: '🏠',
      simplify: false,
      photoPath: 'p.jpg',
      country: 'FR',
      creatorMemberId: 'm-mine',
      creatorProfileId: null,
    });
  });

  it('useUpdateGroup queues the patch as-is', async () => {
    await mutation<Record<string, unknown>>(() => hooks.useUpdateGroup('g-1')).mutationFn({
      name: 'New',
    });
    expect(onlyMutate()).toEqual([MutationKind.GroupUpdate, 'g-1', { name: 'New' }]);
  });

  it('useLeaveGroup forgets the group locally before refreshing', async () => {
    const leave = mutation<string>(() => hooks.useLeaveGroup('g-1'));
    await leave.mutationFn('m-1');
    expect(api.leaveGroup).toHaveBeenCalledWith('m-1');
    await leave.onSuccess?.();
    expect(sync.forgetGroup).toHaveBeenCalledWith('g-1');
    await settled();
    expect(syncModule.engineFlush).toHaveBeenCalledWith({ groupIds: ['g-1'] });
  });

  it('useDeleteGroup deletes through the RPC, then forgets it here', async () => {
    const del = mutation<void>(() => hooks.useDeleteGroup('g-1'));
    await del.mutationFn(undefined);
    expect(api.deleteGroup).toHaveBeenCalledWith('g-1');
    await del.onSuccess?.();
    expect(sync.forgetGroup).toHaveBeenCalledWith('g-1');
    await settled();
  });

  it('useSetGroupPin pins on the personal scope with a derived id, and unpins the same row', async () => {
    const pin = mutation<{ groupId: string; pinned: boolean }, string>(() =>
      hooks.useSetGroupPin(),
    );
    const pinId = groupPinId(OWNER, 'g-1');
    await expect(pin.mutationFn({ groupId: 'g-1', pinned: true })).resolves.toBe(pinId);
    await pin.mutationFn({ groupId: 'g-1', pinned: false });
    expect(sync.mutate.mock.calls).toEqual([
      [MutationKind.GroupPinSet, groupPinsScope(OWNER), { pinId, groupId: 'g-1' }],
      [MutationKind.GroupPinClear, groupPinsScope(OWNER), { pinId }],
    ]);
  });

  it('useSetGroupPin refuses without a session', async () => {
    auth.value = { session: null, profile: null };
    const pin = mutation<{ groupId: string; pinned: boolean }>(() => hooks.useSetGroupPin());
    await expect(pin.mutationFn({ groupId: 'g-1', pinned: true })).rejects.toThrow('Sign in');
    expect(sync.mutate).not.toHaveBeenCalled();
  });
});

describe('members', () => {
  it('useAddGhostMember queues a ghost under a client-chosen id', async () => {
    const add = mutation<unknown, string>(() => hooks.useAddGhostMember('g-1'));
    await expect(add.mutationFn('Ravi')).resolves.toBe('uuid-1');
    expect(onlyMutate()).toEqual([
      MutationKind.MemberAddGhost,
      'g-1',
      { memberId: 'uuid-1', name: 'Ravi', email: null, phone: null },
    ]);
  });

  it('useAddGhostMember reads a bare local number in the account country', async () => {
    const add = mutation<unknown, string>(() => hooks.useAddGhostMember('g-1'));
    await add.mutationFn({ name: 'Ravi', email: 'r@example.com', phone: '98765 43210' });
    expect(onlyMutate()[2]).toEqual({
      memberId: 'uuid-1',
      name: 'Ravi',
      email: 'r@example.com',
      phone: '+919876543210',
    });
  });

  it('useAddGhostMember refuses a local number with no region to read it in', async () => {
    auth.value = { session: { user: { id: OWNER } }, profile: { id: 'p-me', country_code: null } };
    const add = mutation<unknown, string>(() => hooks.useAddGhostMember('g-1'));
    await expect(add.mutationFn({ name: 'Ravi', phone: '9876543210' })).rejects.toThrow();
    expect(sync.mutate).not.toHaveBeenCalled();
  });

  it('useUpdateMember and useSetMemberRole call the server, then refresh the group', async () => {
    const update = mutation<{ memberId: string; patch: Record<string, unknown> }>(() =>
      hooks.useUpdateMember('g-1'),
    );
    await update.mutationFn({ memberId: 'm-1', patch: { vpa: 'a@upi' } });
    expect(api.updateMember).toHaveBeenCalledWith('m-1', { vpa: 'a@upi' });
    update.onSuccess?.();
    await settled();

    const role = mutation<{ memberId: string; role: 'admin' | 'member' }>(() =>
      hooks.useSetMemberRole('g-1'),
    );
    await role.mutationFn({ memberId: 'm-2', role: 'admin' });
    expect(api.setMemberRole).toHaveBeenCalledWith('m-2', 'admin');
    role.onSuccess?.();
    expect(syncModule.engineFlush).toHaveBeenCalled();
  });

  it('useDecideMemberClaim refreshes the claims and the members together', async () => {
    const decide = mutation<{ claimId: string; approve: boolean }>(() =>
      hooks.useDecideMemberClaim('g-1'),
    );
    await decide.mutationFn({ claimId: 'c-1', approve: true });
    expect(api.decideMemberClaim).toHaveBeenCalledWith('c-1', true);
    await decide.onSuccess?.();
    expect(query.client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['group', 'g-1', 'member-claims'],
    });
    await vi.waitFor(() =>
      expect(query.client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['group', 'g-1'] }),
    );
  });
});

describe('expenses', () => {
  const input = {
    description: 'Dinner',
    category: 'food',
    expenseDate: '2026-02-01',
    currency: 'INR',
    amount: 900n,
    splitParams: { kind: 'equal' as const, members: ['m1', 'm2'] },
    participants: ['m1', 'm2'],
    payers: { m1: 900n },
  };

  it('useWriteExpense creates under a new id', async () => {
    const write = mutation<Record<string, unknown>, string>(() => hooks.useWriteExpense('g-1'));
    await expect(write.mutationFn(input)).resolves.toBe('uuid-1');
    const [kind, scope, payload] = onlyMutate();
    expect(kind).toBe(MutationKind.ExpenseCreate);
    expect(scope).toBe('g-1');
    expect(payload).toMatchObject({ expenseId: 'uuid-1', amount: '900', description: 'Dinner' });
  });

  it('useWriteExpense updates when the expense already has an id', async () => {
    const write = mutation<Record<string, unknown>, string>(() => hooks.useWriteExpense('g-1'));
    await expect(write.mutationFn({ ...input, expenseId: 'e-1' })).resolves.toBe('e-1');
    expect(onlyMutate()[0]).toBe(MutationKind.ExpenseUpdate);
  });

  it('useDeleteExpense and useRestoreExpense queue by expense id', async () => {
    await mutation<string>(() => hooks.useDeleteExpense('g-1')).mutationFn('e-1');
    await mutation<string>(() => hooks.useRestoreExpense('g-1')).mutationFn('e-1');
    expect(sync.mutate.mock.calls).toEqual([
      [MutationKind.ExpenseDelete, 'g-1', { expenseId: 'e-1' }],
      [MutationKind.ExpenseRestore, 'g-1', { expenseId: 'e-1' }],
    ]);
  });

  it('useRemoveExpenseReceipt removes it, then pulls the audit line back', async () => {
    const remove = mutation<void>(() => hooks.useRemoveExpenseReceipt('g-1', 'e-1'));
    await remove.mutationFn(undefined);
    expect(api.removeExpenseReceipt).toHaveBeenCalledWith('g-1', 'e-1');
    remove.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();
  });
});

describe('settlements', () => {
  it('useRecordSettlement queues decimal strings and a stable settlement id', async () => {
    const record = mutation<Record<string, unknown>>(() => hooks.useRecordSettlement('g-1'));
    await record.mutationFn({
      groupId: 'g-1',
      fromMemberId: 'a',
      toMemberId: 'b',
      amount: 12_345n,
      rail: 'upi',
      currency: 'INR',
      note: 'thanks',
      allocations: [{ expenseId: 'e-1', amount: 345n }],
      clientMutationId: 'cm-1',
    });
    expect(onlyMutate()).toEqual([
      MutationKind.SettlementCreate,
      'g-1',
      {
        settlementId: 'uuid-1',
        from: 'a',
        to: 'b',
        amount: '12345',
        method: 'upi',
        rail: 'upi',
        currency: 'INR',
        note: 'thanks',
        allocations: [{ expenseId: 'e-1', amount: '345' }],
      },
      'cm-1',
    ]);
  });

  it('useRecordSettlement files an unknown rail under "other" but keeps the rail', async () => {
    const record = mutation<Record<string, unknown>>(() => hooks.useRecordSettlement('g-1'));
    await record.mutationFn({
      groupId: 'g-1',
      fromMemberId: 'a',
      toMemberId: 'b',
      amount: 1n,
      rail: 'paypal',
    });
    expect(onlyMutate()[2]).toMatchObject({
      method: 'other',
      rail: 'paypal',
      currency: null,
      note: null,
      allocations: [],
    });
  });

  it('confirm, cancel and dispute are one transition each', async () => {
    await mutation<string>(() => hooks.useConfirmSettlement('g-1')).mutationFn('s-1');
    await mutation<string>(() => hooks.useCancelSettlement('g-1')).mutationFn('s-1');
    await mutation<string>(() => hooks.useDisputeSettlement('g-1')).mutationFn('s-1');
    expect(sync.mutate.mock.calls).toEqual([
      [MutationKind.SettlementTransition, 'g-1', { settlementId: 's-1', to: 'confirmed' }],
      [MutationKind.SettlementTransition, 'g-1', { settlementId: 's-1', to: 'cancelled' }],
      [MutationKind.SettlementTransition, 'g-1', { settlementId: 's-1', to: 'disputed' }],
    ]);
  });
});

describe('captures', () => {
  const capture = {
    description: '  Tea  ',
    expenseDate: '2026-02-01',
    currency: 'INR',
    amount: 2_000n,
  };

  it('serialiseCapture trims, stringifies the amount and fills every optional field', () => {
    expect(hooks.serialiseCapture(capture, 'c-1')).toEqual({
      captureId: 'c-1',
      description: 'Tea',
      category: null,
      expenseDate: '2026-02-01',
      currency: 'INR',
      amount: '2000',
      notes: null,
      photoPath: null,
      rawText: null,
      parsed: null,
      paymentMethod: null,
      targetGroupId: null,
      categoryMeta: null,
      location: null,
    });
  });

  it('create, update, delete and assign all ride the personal scope', async () => {
    const create = mutation<typeof capture, string>(() => hooks.useCreateCapture());
    await expect(create.mutationFn(capture)).resolves.toBe('uuid-1');
    const update = mutation<typeof capture & { captureId: string }, string>(() =>
      hooks.useUpdateCapture(),
    );
    await expect(update.mutationFn({ ...capture, captureId: 'c-1' })).resolves.toBe('c-1');
    await mutation<string, string>(() => hooks.useDeleteCapture()).mutationFn('c-2');
    await mutation<{ captureId: string; groupId: string; expenseId: string }, string>(() =>
      hooks.useAssignCapture(),
    ).mutationFn({ captureId: 'c-3', groupId: 'g-1', expenseId: 'e-1' });

    const calls = sync.mutate.mock.calls;
    expect(calls.map((call) => [call[0], call[1]])).toEqual([
      [MutationKind.CaptureCreate, OWNER],
      [MutationKind.CaptureUpdate, OWNER],
      [MutationKind.CaptureDelete, OWNER],
      [MutationKind.CaptureAssign, OWNER],
    ]);
    expect(calls[0]?.[2]).toMatchObject({ captureId: 'uuid-1', amount: '2000' });
    expect(calls[1]?.[2]).toMatchObject({ captureId: 'c-1' });
    expect(calls[2]?.[2]).toEqual({ captureId: 'c-2' });
    expect(calls[3]?.[2]).toEqual({ captureId: 'c-3', groupId: 'g-1', expenseId: 'e-1' });
  });

  it('an SMS draft stays on the device: never queued, and a repeat returns null so it is not counted', async () => {
    const sms = {
      ...capture,
      captureId: 'sms-1',
      parsed: { source: 'sms', channel: 'paste', dedupeKey: 'k-1' },
    };
    const create = mutation<typeof sms, string | null>(() => hooks.useCreateCapture());

    await expect(create.mutationFn(sms)).resolves.toBe('sms-1');
    // The paste screen counts what landed: the second paste of the same message is null.
    await expect(create.mutationFn(sms)).resolves.toBeNull();
    // Dismissing it is local too.
    await mutation<string, string>(() => hooks.useDeleteCapture()).mutationFn('sms-1');

    expect(sync.mutate).not.toHaveBeenCalled();
  });

  it('every capture write refuses without a session', async () => {
    auth.value = { session: null, profile: null };
    await expect(
      mutation<typeof capture>(() => hooks.useCreateCapture()).mutationFn(capture),
    ).rejects.toThrow('Sign in');
    await expect(
      mutation<typeof capture & { captureId: string }>(() => hooks.useUpdateCapture()).mutationFn({
        ...capture,
        captureId: 'c',
      }),
    ).rejects.toThrow('Sign in');
    await expect(mutation<string>(() => hooks.useDeleteCapture()).mutationFn('c')).rejects.toThrow(
      'Sign in',
    );
    await expect(
      mutation<{ captureId: string; groupId: string; expenseId: string }>(() =>
        hooks.useAssignCapture(),
      ).mutationFn({ captureId: 'c', groupId: 'g', expenseId: 'e' }),
    ).rejects.toThrow('Sign in');
    expect(sync.mutate).not.toHaveBeenCalled();
  });
});

describe('the tag catalog', () => {
  it('a new tag gets an id and goes after everything already there', async () => {
    sync.mirror = mirrorOf({
      [SyncTable.CategoryTags]: [
        {
          id: 't-1',
          group_id: 'scope',
          owner_user_id: OWNER,
          label: 'Old',
          sort_order: 40,
          deleted_at: null,
        },
      ],
    });
    const upsert = mutation<Record<string, unknown>, string>(() => hooks.useUpsertTag());
    await expect(upsert.mutationFn({ label: 'Snacks' })).resolves.toBe('uuid-1');
    const [kind, scope, payload] = onlyMutate() as [string, string, { sortOrder: number }];
    expect(kind).toBe(MutationKind.TagCreate);
    expect(scope).toBe(categoryTagsScope(OWNER));
    expect(payload).toMatchObject({
      tagId: 'uuid-1',
      builtinId: null,
      label: 'Snacks',
      icon: null,
      tint: null,
      hidden: false,
    });
    expect(payload.sortOrder).toBeGreaterThan(40);
  });

  it('editing a tag keeps its id and the order it was given', async () => {
    const upsert = mutation<Record<string, unknown>, string>(() => hooks.useUpsertTag());
    await upsert.mutationFn({ tagId: 't-1', builtinId: 'food', sortOrder: 3, hidden: true });
    expect(onlyMutate()).toEqual([
      MutationKind.TagUpdate,
      categoryTagsScope(OWNER),
      {
        tagId: 't-1',
        builtinId: 'food',
        label: null,
        icon: null,
        tint: null,
        sortOrder: 3,
        hidden: true,
      },
    ]);
  });

  it('useDeleteTag soft-deletes on the catalog scope', async () => {
    await expect(
      mutation<string, string>(() => hooks.useDeleteTag()).mutationFn('t-1'),
    ).resolves.toBe('t-1');
    expect(onlyMutate()).toEqual([
      MutationKind.TagDelete,
      categoryTagsScope(OWNER),
      { tagId: 't-1' },
    ]);
  });

  it('tag writes refuse without a session', async () => {
    auth.value = { session: null, profile: null };
    await expect(
      mutation<Record<string, unknown>>(() => hooks.useUpsertTag()).mutationFn({ label: 'x' }),
    ).rejects.toThrow('Sign in');
    await expect(mutation<string>(() => hooks.useDeleteTag()).mutationFn('t')).rejects.toThrow(
      'Sign in',
    );
  });
});

describe('trip plan and budgets', () => {
  it('useAddPlanItem queues a client-chosen id and a decimal planned amount', async () => {
    const add = mutation<Record<string, unknown>>(() => hooks.useAddPlanItem('g-1'));
    await add.mutationFn({
      day: '2026-03-01',
      title: 'Beach',
      plannedMinor: 150_000n,
      currency: 'INR',
    });
    await add.mutationFn({ day: '2026-03-02', title: 'Rest' });
    expect(sync.mutate.mock.calls).toEqual([
      [
        MutationKind.PlanItemCreate,
        'g-1',
        {
          itemId: 'uuid-1',
          day: '2026-03-01',
          title: 'Beach',
          startsAt: null,
          note: null,
          category: null,
          plannedMinor: '150000',
          currency: 'INR',
        },
      ],
      [
        MutationKind.PlanItemCreate,
        'g-1',
        {
          itemId: 'uuid-2',
          day: '2026-03-02',
          title: 'Rest',
          startsAt: null,
          note: null,
          category: null,
          plannedMinor: null,
          currency: null,
        },
      ],
    ]);
  });

  it('done, remove, and my budget set/clear', async () => {
    await mutation<{ itemId: string; done: boolean }>(() =>
      hooks.useSetPlanItemDone('g-1'),
    ).mutationFn({
      itemId: 'p-1',
      done: true,
    });
    await mutation<string>(() => hooks.useRemovePlanItem('g-1')).mutationFn('p-1');
    await mutation<Record<string, unknown>>(() => hooks.useSetMyTripBudget('g-1')).mutationFn({
      amountMinor: 5_000n,
      visibility: 'group',
    });
    await mutation<void>(() => hooks.useClearMyTripBudget('g-1')).mutationFn(undefined);
    expect(sync.mutate.mock.calls).toEqual([
      [MutationKind.PlanItemUpdate, 'g-1', { itemId: 'p-1', done: true }],
      [MutationKind.PlanItemDelete, 'g-1', { itemId: 'p-1' }],
      [
        MutationKind.MemberBudgetSet,
        'g-1',
        { amountMinor: '5000', currency: null, visibility: 'group' },
      ],
      [MutationKind.MemberBudgetClear, 'g-1', {}],
    ]);
  });

  it('group, category and rate setters send null to clear', async () => {
    const group = mutation<Record<string, unknown>>(() => hooks.useSetGroupBudget('g-1'));
    await group.mutationFn({ amountMinor: 10_000n, currency: 'INR' });
    await group.mutationFn({ amountMinor: null });
    const category = mutation<Record<string, unknown>>(() => hooks.useSetCategoryBudget('g-1'));
    await category.mutationFn({ category: 'food', amountMinor: 700n, currency: 'INR' });
    await category.mutationFn({ category: 'food', amountMinor: null });
    const rate = mutation<Record<string, unknown>>(() => hooks.useSetGroupFxRate('g-1'));
    await rate.mutationFn({ from: 'USD', num: 8_300n, den: 100n, source: 'bill' });
    await rate.mutationFn({ from: 'USD', num: null, den: null });
    expect(sync.mutate.mock.calls).toEqual([
      [MutationKind.GroupBudgetSet, 'g-1', { amountMinor: '10000', currency: 'INR' }],
      [MutationKind.GroupBudgetSet, 'g-1', { amountMinor: null, currency: null }],
      [
        MutationKind.CategoryBudgetSet,
        'g-1',
        { category: 'food', amountMinor: '700', currency: 'INR' },
      ],
      [
        MutationKind.CategoryBudgetSet,
        'g-1',
        { category: 'food', amountMinor: null, currency: null },
      ],
      [
        MutationKind.GroupFxRateSet,
        'g-1',
        { from: 'USD', num: '8300', den: '100', source: 'bill' },
      ],
      [MutationKind.GroupFxRateSet, 'g-1', { from: 'USD', num: null, den: null, source: 'manual' }],
    ]);
  });
});

describe('attachments', () => {
  const picked = { base64: 'QUJD', mimeType: 'image/webp', preview: 'data:x' };

  it('useAnnotateExpenseAttachment sets the markup, then pulls it back', async () => {
    const annotate = mutation<{ attachmentId: string; annotations: unknown }>(() =>
      hooks.useAnnotateExpenseAttachment(),
    );
    await annotate.mutationFn({ attachmentId: 'a-1', annotations: null });
    expect(backend.rpc).toHaveBeenCalledWith('waves_annotate_expense_attachment', {
      p_attachment_id: 'a-1',
      p_annotations: null,
    });
    annotate.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();

    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not a party' } });
    await expect(annotate.mutationFn({ attachmentId: 'a-1', annotations: null })).rejects.toThrow(
      'not a party',
    );
  });

  it('useReplaceExpenseAttachmentImage uploads, repoints, then frees the old bytes', async () => {
    const replace = mutation<Record<string, unknown>>(() =>
      hooks.useReplaceExpenseAttachmentImage('g-1', 'e-1'),
    );
    await replace.mutationFn({ attachmentId: 'a-1', oldStoragePath: 'e-1/old.jpg', picked });
    expect(storage.putImage).toHaveBeenCalledWith({
      bucket: 'expense-attachments',
      path: 'e-1/uuid-1.webp',
      base64: 'QUJD',
      contentType: 'image/webp',
      groupId: 'g-1',
      subjectId: 'e-1',
    });
    expect(backend.rpc).toHaveBeenCalledWith('waves_replace_expense_attachment_image', {
      p_attachment_id: 'a-1',
      p_new_path: 'e-1/uuid-1.webp',
      p_preview: 'data:x',
    });
    expect(storage.removeRestrictedImage).toHaveBeenCalledWith(
      'expense-attachments',
      'e-1',
      'e-1/old.jpg',
    );
    replace.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();
  });

  it('useReplaceExpenseAttachmentImage cleans up the new upload when the RPC refuses', async () => {
    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'refused' } });
    const replace = mutation<Record<string, unknown>>(() =>
      hooks.useReplaceExpenseAttachmentImage('g-1', 'e-1'),
    );
    await expect(
      replace.mutationFn({
        attachmentId: 'a-1',
        oldStoragePath: 'e-1/old.jpg',
        picked: { base64: 'QUJD', mimeType: 'image/jpeg' },
      }),
    ).rejects.toThrow('refused');
    expect(storage.removeRestrictedImage).toHaveBeenCalledTimes(1);
    expect(storage.removeRestrictedImage).toHaveBeenCalledWith(
      'expense-attachments',
      'e-1',
      'e-1/uuid-1.jpg',
    );
  });

  it('useReplaceExpenseAttachmentImage has nothing to clean when the upload itself fails', async () => {
    storage.putImage.mockRejectedValueOnce(new Error('offline'));
    const replace = mutation<Record<string, unknown>>(() =>
      hooks.useReplaceExpenseAttachmentImage('g-1', 'e-1'),
    );
    await expect(
      replace.mutationFn({ attachmentId: 'a-1', oldStoragePath: 'old', picked }),
    ).rejects.toThrow('offline');
    expect(backend.rpc).not.toHaveBeenCalled();
    expect(storage.removeRestrictedImage).not.toHaveBeenCalled();
  });

  it('useRemoveExpenseAttachment soft-deletes, and a failed byte cleanup is not an error', async () => {
    storage.removeRestrictedImage.mockRejectedValueOnce(new Error('gone already'));
    const remove = mutation<{ attachmentId: string; storagePath: string }>(() =>
      hooks.useRemoveExpenseAttachment('e-1'),
    );
    await remove.mutationFn({ attachmentId: 'a-1', storagePath: 'e-1/a.jpg' });
    expect(backend.rpc).toHaveBeenCalledWith('waves_remove_expense_attachment', {
      p_attachment_id: 'a-1',
    });
    remove.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();

    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    await expect(remove.mutationFn({ attachmentId: 'a-1', storagePath: 'x' })).rejects.toThrow(
      'no',
    );
  });
});

describe('comments', () => {
  it('useAddExpenseComment sanitises, sends under a client id, and returns it', async () => {
    const add = mutation<{ body: string }, { id: string; body: string } | null>(() =>
      hooks.useAddExpenseComment('g-1', 'e-1'),
    );
    await expect(add.mutationFn({ body: '  **paid** ' })).resolves.toEqual({
      id: 'uuid-1',
      body: expect.stringContaining('**paid**'),
    });
    expect(backend.rpc).toHaveBeenCalledWith('waves_add_expense_comment', {
      p_group_id: 'g-1',
      p_expense_id: 'e-1',
      p_comment_id: 'uuid-1',
      p_body: expect.stringContaining('**paid**'),
    });
    add.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();
  });

  it('useAddExpenseComment sends nothing for a comment that sanitises to empty', async () => {
    const add = mutation<{ body: string }, unknown>(() => hooks.useAddExpenseComment('g-1', 'e-1'));
    await expect(add.mutationFn({ body: '   ' })).resolves.toBeNull();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('useAddExpenseComment surfaces a refusal', async () => {
    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not a member' } });
    const add = mutation<{ body: string }>(() => hooks.useAddExpenseComment('g-1', 'e-1'));
    await expect(add.mutationFn({ body: 'hi' })).rejects.toThrow('not a member');
  });

  it('edit, delete and flag each make one RPC and flush after', async () => {
    const edit = mutation<{ commentId: string; body: string }>(() => hooks.useEditExpenseComment());
    await edit.mutationFn({ commentId: 'c-1', body: 'fixed' });
    await edit.mutationFn({ commentId: 'c-1', body: '  ' });
    await mutation<{ commentId: string }>(() => hooks.useDeleteExpenseComment()).mutationFn({
      commentId: 'c-2',
    });
    await mutation<{ commentId: string; flag: boolean }>(() =>
      hooks.useFlagExpenseComment(),
    ).mutationFn({ commentId: 'c-3', flag: true });
    expect(backend.rpc.mock.calls).toEqual([
      ['waves_edit_expense_comment', { p_comment_id: 'c-1', p_body: 'fixed' }],
      ['waves_delete_expense_comment', { p_comment_id: 'c-2' }],
      ['waves_flag_expense_comment', { p_comment_id: 'c-3', p_flag: true }],
    ]);
    const writes: (() => unknown)[] = [
      hooks.useEditExpenseComment,
      hooks.useDeleteExpenseComment,
      hooks.useFlagExpenseComment,
    ];
    for (const hook of writes) mutation(hook).onSuccess?.();
    expect(sync.flush).toHaveBeenCalledTimes(3);
  });

  it('edit, delete and flag surface a refusal', async () => {
    backend.rpc.mockResolvedValue({ data: null, error: { message: 'author only' } });
    await expect(
      mutation<{ commentId: string; body: string }>(() => hooks.useEditExpenseComment()).mutationFn(
        {
          commentId: 'c',
          body: 'x',
        },
      ),
    ).rejects.toThrow('author only');
    await expect(
      mutation<{ commentId: string }>(() => hooks.useDeleteExpenseComment()).mutationFn({
        commentId: 'c',
      }),
    ).rejects.toThrow('author only');
    await expect(
      mutation<{ commentId: string; flag: boolean }>(() =>
        hooks.useFlagExpenseComment(),
      ).mutationFn({
        commentId: 'c',
        flag: false,
      }),
    ).rejects.toThrow('author only');
  });
});

describe('settlement proofs', () => {
  it('useAttachSettlementProof does nothing when no photo is picked', async () => {
    image.pickAlbumPhoto.mockResolvedValueOnce(null);
    await mutation<void>(() => hooks.useAttachSettlementProof('g-1', 's-1')).mutationFn(undefined);
    expect(storage.putImage).not.toHaveBeenCalled();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('useAttachSettlementProof uploads the picked photo and records it', async () => {
    image.pickAlbumPhoto.mockResolvedValueOnce({ base64: 'QUJD', mimeType: 'image/jpeg' });
    const attach = mutation<void>(() => hooks.useAttachSettlementProof('g-1', 's-1'));
    await attach.mutationFn(undefined);
    expect(storage.putImage).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'settlement-proofs', path: 's-1/uuid-1.jpg' }),
    );
    expect(backend.rpc).toHaveBeenCalledWith('waves_attach_settlement_proof', {
      p_settlement_id: 's-1',
      p_storage_path: 's-1/uuid-1.jpg',
      p_proof_id: 'uuid-2',
    });
    attach.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();
  });

  it('useAttachSettlementProof frees the upload when the RPC refuses', async () => {
    image.pickAlbumPhoto.mockResolvedValueOnce({ base64: 'QUJD', mimeType: 'image/webp' });
    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not a party' } });
    await expect(
      mutation<void>(() => hooks.useAttachSettlementProof('g-1', 's-1')).mutationFn(undefined),
    ).rejects.toThrow('not a party');
    expect(storage.removeRestrictedImage).toHaveBeenCalledWith(
      'settlement-proofs',
      's-1',
      's-1/uuid-1.webp',
    );
  });

  it('useAttachSettlementProof has nothing to free when the upload fails', async () => {
    image.pickAlbumPhoto.mockResolvedValueOnce({ base64: 'QUJD', mimeType: 'image/jpeg' });
    storage.putImage.mockRejectedValueOnce(new Error('offline'));
    await expect(
      mutation<void>(() => hooks.useAttachSettlementProof('g-1', 's-1')).mutationFn(undefined),
    ).rejects.toThrow('offline');
    expect(storage.removeRestrictedImage).not.toHaveBeenCalled();
  });

  it('useRemoveSettlementProof soft-deletes then frees the bytes best-effort', async () => {
    storage.removeRestrictedImage.mockRejectedValueOnce(new Error('gone'));
    const remove = mutation<{ proofId: string; storagePath: string }>(() =>
      hooks.useRemoveSettlementProof('s-1'),
    );
    await remove.mutationFn({ proofId: 'pr-1', storagePath: 's-1/p.jpg' });
    expect(backend.rpc).toHaveBeenCalledWith('waves_remove_settlement_proof', {
      p_proof_id: 'pr-1',
    });
    expect(storage.removeRestrictedImage).toHaveBeenCalledWith(
      'settlement-proofs',
      's-1',
      's-1/p.jpg',
    );
    remove.onSuccess?.();
    expect(sync.flush).toHaveBeenCalled();

    backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    await expect(remove.mutationFn({ proofId: 'pr-1', storagePath: 'x' })).rejects.toThrow('no');
  });
});
