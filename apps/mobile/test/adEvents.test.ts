import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/backend', () => ({ backend: { rpc } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
import { adClocks, flushAdEvents, logAdEvent } from '@/lib/adEvents';

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
