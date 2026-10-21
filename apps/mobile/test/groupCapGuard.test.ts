import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupCapGate, PlanTier } from '@waves/core';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const state = vi.hoisted(() => ({
  entitlement: { tier: 'free' as string, loading: false },
  viewerId: 'me' as string | null,
  groups: { data: [] as unknown[] | undefined },
  /** Live members per group id; a group not listed has one (its creator). */
  members: {} as Record<string, number>,
  push: vi.fn(),
  confirm: vi.fn(() => Promise.resolve(false)),
  // Stable across renders, as the real hooks' values are, so the identity test holds.
  sync: { mirror: {}, queue: [] },
  strings: {
    t: {
      groupCap: {
        title: 'Group limit reached',
        body: 'Free plan lets you create up to {n} groups.',
        upgrade: 'Upgrade',
      },
    },
  },
}));

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@/lib/navigation', () => ({ router: { push: state.push } }));
vi.mock('@/data/hooks', () => ({ useGroups: () => state.groups }));
vi.mock('@/lib/auth', () => ({ useViewerId: () => state.viewerId }));
vi.mock('@/lib/useEntitlement', () => ({ useEntitlement: () => state.entitlement }));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ confirm: state.confirm }) }));
vi.mock('@/sync', () => ({ useSync: () => state.sync }));
vi.mock('@/i18n', () => ({
  fill: (template: string, values: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
  useStrings: () => state.strings,
}));
vi.mock('@waves/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@waves/core')>()),
  materialiseMembers: (_mirror: unknown, _queue: unknown, options: { groupId: string }) =>
    Array.from({ length: state.members[options.groupId] ?? 1 }, (_, index) => ({
      id: String(index),
    })),
}));

const { createGroupCapGuard, useGroupCapGuard } = await import('../src/lib/groupCapGuard');

const mine = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  created_by: 'me',
  deleted_at: null,
  ...extra,
});

describe('createGroupCapGuard', () => {
  it('waves everything through while the plan is unknown', () => {
    const send = vi.fn();
    const guard = createGroupCapGuard(null, send);
    expect(guard.gate).toBeNull();
    expect(guard.blockCreate()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks at the ceiling and raises the prompt once per ask', () => {
    const send = vi.fn();
    const guard = createGroupCapGuard(
      groupCapGate({ tier: PlanTier.Free, createdCount: 10 }),
      send,
    );
    expect(guard.blockCreate()).toBe(true);
    expect(guard.blockCreate()).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('lets a Free account under the ceiling, and any Pro account, through', () => {
    const send = vi.fn();
    expect(
      createGroupCapGuard(
        groupCapGate({ tier: PlanTier.Free, createdCount: 9 }),
        send,
      ).blockCreate(),
    ).toBe(false);
    expect(
      createGroupCapGuard(
        groupCapGate({ tier: PlanTier.Pro, createdCount: 99 }),
        send,
      ).blockCreate(),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the guard a screen holds', () => {
  beforeEach(() => {
    state.entitlement = { tier: PlanTier.Free, loading: false };
    state.viewerId = 'me';
    state.groups = { data: [] };
    state.members = {};
    state.push.mockClear();
    state.confirm.mockClear();
    state.confirm.mockImplementation(() => Promise.resolve(false));
  });

  it('counts only the groups I started, not deleted, pairs left out', () => {
    state.groups = {
      data: [
        ...Array.from({ length: 9 }, (_, index) => mine(`g${index}`)),
        { id: 'theirs', created_by: 'them', deleted_at: null },
        mine('gone', { deleted_at: '2026-01-01T00:00:00Z' }),
        mine('pair'),
        { id: 'demo', isDemo: true, deleted_at: null },
      ],
    };
    state.members = { pair: 2, theirs: 4 };
    const guard = renderHook(() => useGroupCapGuard()).result.current;
    expect(guard.gate).toMatchObject({ created: 9, limit: 10, canCreate: true });
    expect(guard.blockCreate()).toBe(false);
  });

  it('counts a group that exists only in the local queue as mine', () => {
    state.groups = {
      data: [
        ...Array.from({ length: 9 }, (_, index) => mine(`g${index}`)),
        { id: 'offline', pending: true, deleted_at: null },
      ],
    };
    const guard = renderHook(() => useGroupCapGuard()).result.current;
    expect(guard.gate).toMatchObject({ created: 10, canCreate: false });
  });

  it('blocks a Free account at ten with the upgrade prompt, and goes to upgrade on yes', async () => {
    state.groups = { data: Array.from({ length: 10 }, (_, index) => mine(`g${index}`)) };
    state.confirm.mockImplementation(() => Promise.resolve(true));
    const guard = renderHook(() => useGroupCapGuard()).result.current;

    expect(guard.blockCreate()).toBe(true);
    expect(state.confirm).toHaveBeenCalledWith({
      title: 'Group limit reached',
      body: 'Free plan lets you create up to 10 groups.',
      confirmLabel: 'Upgrade',
    });
    await Promise.resolve();
    expect(state.push).toHaveBeenCalledWith('/settings/upgrade');
  });

  it('stays put when the prompt is dismissed', async () => {
    state.groups = { data: Array.from({ length: 10 }, (_, index) => mine(`g${index}`)) };
    const guard = renderHook(() => useGroupCapGuard()).result.current;
    expect(guard.blockCreate()).toBe(true);
    await Promise.resolve();
    expect(state.push).not.toHaveBeenCalled();
  });

  it('never blocks Pro', () => {
    state.entitlement = { tier: PlanTier.Pro, loading: false };
    state.groups = { data: Array.from({ length: 30 }, (_, index) => mine(`g${index}`)) };
    const guard = renderHook(() => useGroupCapGuard()).result.current;
    expect(guard.blockCreate()).toBe(false);
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it('fails open while the plan is still being read', () => {
    state.entitlement = { tier: PlanTier.Free, loading: true };
    state.groups = { data: Array.from({ length: 10 }, (_, index) => mine(`g${index}`)) };
    const guard = renderHook(() => useGroupCapGuard()).result.current;
    expect(guard.gate).toBeNull();
    expect(guard.blockCreate()).toBe(false);
  });

  it('keeps the same guard across renders until something it depends on changes', () => {
    const view = renderHook(() => useGroupCapGuard());
    const first = view.result.current;
    view.rerender();
    expect(view.result.current).toBe(first);

    state.groups = { data: [mine('g1')] };
    view.rerender();
    expect(view.result.current).not.toBe(first);
  });
});
