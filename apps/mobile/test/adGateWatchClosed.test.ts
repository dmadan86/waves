import { beforeEach, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(),
  NetworkStateType: { WIFI: 'WIFI' },
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: 'android' },
}));
vi.mock('@/lib/backend', () => ({ backend: { rpc } }));
vi.mock('@/lib/adsSdk', () => ({ defaultRewardedAdDeps: vi.fn() }));
vi.mock('@/lib/adGateRunner', () => ({ runGateAd: vi.fn(), prepareInterstitial: vi.fn() }));
vi.mock('@/lib/adSensitiveMoment', () => ({ adsAreQuiet: () => true }));
vi.mock('@/sync/engine', () => ({
  syncEngine: { getState: () => ({ queue: [] }), flush: vi.fn() },
  SyncStatus: { Idle: 'idle' },
}));
vi.mock('@/lib/adEvents', () => ({
  adClocks: {},
  flushAdEvents: () => Promise.resolve(),
  logAdEvent: vi.fn(),
}));

const { watchGate } = await import('@/lib/adGates');

beforeEach(() => rpc.mockReset());

it('an unreadable gate status (offline) fails closed instead of bypassing the ad', async () => {
  rpc.mockRejectedValue(new Error('Network request failed'));
  expect(await watchGate('p-1', 'group_create_rewarded')).toBe('failed');
  rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
  expect(await watchGate('p-1', 'export_rewarded')).toBe('failed');
});

it('a gate the server says is off still passes', async () => {
  rpc.mockResolvedValue({ data: { enabled: false, createdGroups: 0 }, error: null });
  expect(await watchGate('p-1', 'group_create_rewarded')).toBe('bypass');
});
