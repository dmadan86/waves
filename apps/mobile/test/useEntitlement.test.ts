/**
 * `useEntitlement`: the store's tier (RevenueCat CustomerInfo) and the server's
 * (`waves_my_plan`) side by side, the higher winning. Hooks are faked, so the
 * hook runs as a plain function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanTier } from '@waves/core';

import { useEntitlement } from '../src/lib/useEntitlement';

const state = vi.hoisted(() => ({
  store: { tier: 'free', info: null, loading: false } as {
    tier: string;
    info: unknown;
    loading: boolean;
  },
  viewerId: 'viewer-1' as string | null,
  serverData: undefined as unknown,
  available: true,
  query: undefined as
    | { queryKey: unknown[]; enabled: boolean; staleTime: number; queryFn: () => Promise<unknown> }
    | undefined,
  rpc: vi.fn(),
  refetch: vi.fn(),
  refreshCustomerInfo: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (fn: unknown) => fn,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: NonNullable<typeof state.query>) => {
    state.query = options;
    return { data: state.serverData, refetch: state.refetch };
  },
}));
vi.mock('@/lib/auth', () => ({ useViewerId: () => state.viewerId }));
vi.mock('@/lib/backend', () => ({ backend: { rpc: state.rpc } }));
vi.mock('@/lib/purchases', () => ({
  useCustomerTier: () => state.store,
  purchasesAvailable: () => state.available,
  refreshCustomerInfo: state.refreshCustomerInfo,
}));

beforeEach(() => {
  state.store = { tier: PlanTier.Free, info: null, loading: false };
  state.viewerId = 'viewer-1';
  state.serverData = undefined;
  state.available = true;
  state.query = undefined;
  state.rpc.mockReset();
  state.refetch.mockReset().mockResolvedValue(undefined);
  state.refreshCustomerInfo.mockReset().mockResolvedValue(undefined);
});

describe('useEntitlement tier', () => {
  it('is Free when neither side knows a plan', () => {
    expect(useEntitlement()).toMatchObject({ tier: PlanTier.Free, isPaid: false, isPro: false });
  });

  it('follows the store when the server has not answered yet', () => {
    state.store = { tier: PlanTier.Pro, info: null, loading: false };
    expect(useEntitlement()).toMatchObject({ tier: PlanTier.Pro, isPaid: true, isPro: true });
  });

  it('follows the server for a plan the stores never saw (a promo row)', () => {
    state.serverData = PlanTier.Pro;
    expect(useEntitlement()).toMatchObject({ tier: PlanTier.Pro, isPaid: true, isPro: true });
  });

  it('takes the higher of the two', () => {
    state.store = { tier: PlanTier.Pro, info: null, loading: false };
    state.serverData = PlanTier.Pro;
    expect(useEntitlement().tier).toBe(PlanTier.Pro);
    state.store = { tier: PlanTier.Pro, info: null, loading: false };
    state.serverData = PlanTier.Pro;
    expect(useEntitlement().tier).toBe(PlanTier.Pro);
  });

  it('passes loading and availability through', () => {
    state.store = { tier: PlanTier.Free, info: null, loading: true };
    state.available = false;
    expect(useEntitlement()).toMatchObject({ loading: true, available: false });
  });
});

describe('the server query', () => {
  it('is keyed by the viewer and waits for one', () => {
    useEntitlement();
    expect(state.query).toMatchObject({ queryKey: ['myPlan', 'viewer-1'], enabled: true });
    state.viewerId = null;
    useEntitlement();
    expect(state.query).toMatchObject({ queryKey: ['myPlan', null], enabled: false });
  });

  it.each([
    [{ plan: 'pro' }, PlanTier.Pro],
    [{ plan: 'plus' }, PlanTier.Pro],
    [{ plan: 'free' }, PlanTier.Free],
    [{ plan: 'gold' }, PlanTier.Free],
    [{}, PlanTier.Free],
    [null, PlanTier.Free],
  ])('reads %j from waves_my_plan as %s', async (data, expected) => {
    state.rpc.mockResolvedValue({ data, error: null });
    useEntitlement();
    await expect(state.query!.queryFn()).resolves.toBe(expected);
    expect(state.rpc).toHaveBeenCalledWith('waves_my_plan');
  });

  it('throws the RPC error rather than reporting Free', async () => {
    const failure = { message: 'jwt expired' };
    state.rpc.mockResolvedValue({ data: null, error: failure });
    useEntitlement();
    await expect(state.query!.queryFn()).rejects.toBe(failure);
  });
});

describe('refresh', () => {
  it('re-reads both CustomerInfo and the server plan', async () => {
    await useEntitlement().refresh();
    expect(state.refreshCustomerInfo).toHaveBeenCalledTimes(1);
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
});
