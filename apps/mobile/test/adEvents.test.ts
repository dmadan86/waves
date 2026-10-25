import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  adClocks,
  flushAdEvents,
  logAdEvent,
  noteAdFailure,
  lastFailureText,
} from '@/lib/adEvents';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/backend', () => ({ backend: { rpc } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));

beforeEach(async () => {
  await AsyncStorage.clear();
  rpc.mockReset();
});
describe('ad telemetry outbox', () => {
  it('preserves event identity and original time on retry and removes acknowledged rows', async () => {
    rpc.mockResolvedValue({ error: { message: 'offline' } });
    logAdEvent('profile-a', 'group_create_rewarded', 'shown');
    await flushAdEvents('profile-a');
    const first = rpc.mock.calls[0]![1];
    expect(first).toMatchObject({
      p_profile: 'profile-a',
      p_placement: 'group_create_rewarded',
      p_outcome: 'shown',
    });
    expect(first.p_event_id).toMatch(/^[\da-f-]{36}$/);
    expect(Date.parse(first.p_occurred_at)).not.toBeNaN();
    expect(JSON.parse((await AsyncStorage.getItem('waves.adEvents.profile-a'))!)).toHaveLength(1);
    rpc.mockResolvedValue({ error: null });
    await flushAdEvents('profile-a');
    expect(rpc.mock.lastCall![1]).toEqual(first);
    expect(JSON.parse((await AsyncStorage.getItem('waves.adEvents.profile-a'))!)).toEqual([]);
  });
  it('does not reattribute a previous account event to the next account', async () => {
    rpc.mockResolvedValue({ error: { message: 'Wrong account' } });
    logAdEvent('old-account', 'quota_rewarded', 'completed');
    await flushAdEvents('old-account');
    await flushAdEvents('new-account');
    expect(rpc.mock.calls.every((call) => call[1].p_profile === 'old-account')).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem('waves.adEvents.old-account'))!)).toHaveLength(1);
  });
  it('updates local quiet clocks immediately, even before telemetry reaches the server', async () => {
    rpc.mockResolvedValue({ error: null });
    logAdEvent('profile-b', 'export_rewarded', 'shown');
    const first = adClocks('profile-b');
    expect(first.lastRewardedAt).toBeGreaterThan(0);
    expect(first.lastAdAt).toBe(first.lastRewardedAt);
    logAdEvent('profile-b', 'native_list', 'shown');
    expect(adClocks('profile-b').lastRewardedAt).toBe(first.lastRewardedAt);
    await flushAdEvents('profile-b');
  });
});

it.each([
  { code: '23514', message: 'invalid outcome' },
  { message: 'ad_events_outcome_check' },
  { message: 'check constraint violated' },
])('drops unsupported events and continues after %j', async (error) => {
  await AsyncStorage.setItem(
    'waves.adEvents.profile-c',
    JSON.stringify([
      {
        id: 'old',
        createdAt: new Date().toISOString(),
        placement: 'export_rewarded',
        outcome: 'offline_allowed',
      },
      {
        id: 'next',
        createdAt: new Date().toISOString(),
        placement: 'export_rewarded',
        outcome: 'shown',
      },
    ]),
  );
  rpc.mockResolvedValueOnce({ error }).mockResolvedValue({ error: null });
  await flushAdEvents('profile-c');
  expect(rpc.mock.calls.map((call) => call[1].p_event_id)).toEqual(['old', 'next']);
  expect(JSON.parse((await AsyncStorage.getItem('waves.adEvents.profile-c'))!)).toEqual([]);
});
it('retains failure text after logging and truncates explicit detail without updating clocks', async () => {
  rpc.mockResolvedValue({ error: null });
  noteAdFailure({ code: 'network-error', message: 'blocked' });
  logAdEvent('details', 'export_rewarded', 'failed');
  logAdEvent('details', 'export_rewarded', 'offline_allowed', 'x'.repeat(201));
  await flushAdEvents('details');
  expect(lastFailureText()).toBe('network-error blocked');
  expect(rpc.mock.calls[0]![1].p_detail).toBe('network-error blocked');
  expect(rpc.mock.calls[1]![1].p_detail).toHaveLength(200);
  expect(adClocks('details').lastAdAt).toBe(0);
});

it.each(['credit_used', 'credit_earned', 'offline_capped'] as const)(
  'drops unsupported %s telemetry',
  async (outcome) => {
    rpc.mockResolvedValue({ error: { code: '23514', message: 'invalid outcome' } });
    logAdEvent('credits', 'export_rewarded', outcome);
    await flushAdEvents('credits');
    expect(JSON.parse((await AsyncStorage.getItem('waves.adEvents.credits'))!)).toEqual([]);
  },
);

it.each(['credit_offer', 'credit_voluntary'] as const)(
  'keeps post-reward quiet time for %s',
  async (placement) => {
    rpc.mockResolvedValue({ error: null });
    const before = Date.now();
    logAdEvent('credit-profile', placement, 'credit_earned');
    expect(adClocks('credit-profile').lastRewardedAt).toBeGreaterThanOrEqual(before);
    expect(adClocks('credit-profile').lastAdAt).toBeGreaterThanOrEqual(before);
    await flushAdEvents('credit-profile');
  },
);
