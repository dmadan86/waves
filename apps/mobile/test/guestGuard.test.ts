import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { guestGate, GuestBlock } from '@waves/core';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const state = vi.hoisted(() => ({
  auth: { isGuest: false, session: null as unknown },
  groups: { data: [] as unknown[] | undefined },
  push: vi.fn(),
}));

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@/lib/navigation', () => ({ router: { push: state.push } }));
vi.mock('@/data/hooks', () => ({ useGroups: () => state.groups }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => state.auth }));

const { createGuestGuard, useGuestGuard, usePersonalOffered } =
  await import('../src/lib/guestGuard');

describe('createGuestGuard', () => {
  it('lets full users through without routing to upgrade', () => {
    const send = vi.fn();
    const guard = createGuestGuard(null, send);

    expect(guard.gate).toBeNull();
    expect(guard.blockAddGroup()).toBe(false);
    expect(guard.blockWrite()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks group creation at the guest group limit but still allows ordinary writes', () => {
    const send = vi.fn();
    const gate = guestGate({
      createdAt: '2026-08-20T00:00:00.000Z',
      groupCount: 1,
      now: new Date('2026-08-21T00:00:00.000Z'),
    });
    const guard = createGuestGuard(gate, send);

    expect(guard.blockAddGroup()).toBe(true);
    expect(send).toHaveBeenCalledWith(GuestBlock.GroupLimit);
    expect(guard.blockWrite()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('blocks every write with trial-expired reason when the guest trial is over', () => {
    const send = vi.fn();
    const gate = guestGate({
      createdAt: '2026-08-01T00:00:00.000Z',
      groupCount: 0,
      now: new Date('2026-08-20T00:00:00.000Z'),
    });
    const guard = createGuestGuard(gate, send);

    expect(guard.blockAddGroup()).toBe(true);
    expect(guard.blockWrite()).toBe(true);
    expect(send).toHaveBeenNthCalledWith(1, GuestBlock.TrialExpired);
    expect(send).toHaveBeenNthCalledWith(2, GuestBlock.TrialExpired);
  });

  it('evaluates many guard checks without mutating the gate object', () => {
    const send = vi.fn();
    const gate = guestGate({
      createdAt: '2026-08-20T00:00:00.000Z',
      groupCount: 1,
      now: new Date('2026-08-21T00:00:00.000Z'),
    });
    const snapshot = { ...gate };
    const guard = createGuestGuard(gate, send);

    for (let i = 0; i < 1_000; i += 1) {
      expect(guard.blockAddGroup()).toBe(true);
    }

    expect(gate).toEqual(snapshot);
    expect(send).toHaveBeenCalledTimes(1_000);
  });
});

describe('the guard a screen holds', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'));
    state.auth = { isGuest: false, session: null };
    state.groups = { data: [] };
    state.push.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has no gate for a full user, who is never sent anywhere', () => {
    state.auth = { isGuest: false, session: { user: { created_at: '2026-08-20T00:00:00Z' } } };
    const guard = renderHook(() => useGuestGuard()).result.current;
    expect(guard.gate).toBeNull();
    expect(guard.blockAddGroup()).toBe(false);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('has no gate for a guest whose account date is not known yet', () => {
    state.auth = { isGuest: true, session: { user: {} } };
    expect(renderHook(() => useGuestGuard()).result.current.gate).toBeNull();
  });

  it('sends a guest already in a group to the account screen with the reason', () => {
    state.auth = { isGuest: true, session: { user: { created_at: '2026-08-20T00:00:00.000Z' } } };
    state.groups = { data: [{ id: 'g1' }] };
    const guard = renderHook(() => useGuestGuard()).result.current;

    expect(guard.blockAddGroup()).toBe(true);
    expect(state.push).toHaveBeenCalledWith(`/settings/account?reason=${GuestBlock.GroupLimit}`);
    expect(guard.blockWrite()).toBe(false);
  });

  it('counts groups that have not loaded as none', () => {
    state.auth = { isGuest: true, session: { user: { created_at: '2026-08-20T00:00:00.000Z' } } };
    state.groups = { data: undefined };
    const guard = renderHook(() => useGuestGuard()).result.current;
    expect(guard.blockAddGroup()).toBe(false);
  });

  it('keeps the same guard across renders until something it depends on changes', () => {
    state.auth = { isGuest: true, session: { user: { created_at: '2026-08-20T00:00:00.000Z' } } };
    const view = renderHook(() => useGuestGuard());
    const first = view.result.current;
    view.rerender();
    expect(view.result.current).toBe(first);

    state.groups = { data: [{ id: 'g1' }] };
    view.rerender();
    expect(view.result.current).not.toBe(first);
  });

  it('offers the personal ledger to a signed-in user and never to a guest', () => {
    expect(renderHook(() => usePersonalOffered()).result.current).toBe(true);
    state.auth = { isGuest: true, session: null };
    expect(renderHook(() => usePersonalOffered()).result.current).toBe(false);
  });
});
