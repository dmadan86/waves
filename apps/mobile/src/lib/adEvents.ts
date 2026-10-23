import { randomUUID } from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { adTimeout } from '@/lib/adTimeout';
import { backend } from '@/lib/backend';

export type AdPlacement =
  | 'expense_interstitial'
  | 'group_create_rewarded'
  | 'export_rewarded'
  | 'native_list'
  | 'quota_rewarded';
export type AdEventOutcome = 'shown' | 'completed' | 'skipped' | 'failed' | 'blocked_grace';
// Immediate process-wide timestamps complement the cross-device server history.
const clocks = new Map<
  string,
  { lastAdAt: number; lastRewardedAt: number; lastInterstitialAt: number }
>();
export function adClocks(profileId: string) {
  return clocks.get(profileId) ?? { lastAdAt: 0, lastRewardedAt: 0, lastInterstitialAt: 0 };
}
interface PendingEvent {
  id: string;
  createdAt: string;
  placement: AdPlacement;
  outcome: AdEventOutcome;
}
let queue = Promise.resolve();
export function logAdEvent(
  profileId: string,
  placement: AdPlacement,
  outcome: AdEventOutcome,
): void {
  if (outcome === 'shown' || outcome === 'completed' || outcome === 'skipped') {
    const now = Date.now();
    clocks.set(profileId, {
      ...adClocks(profileId),
      lastAdAt: now,
      ...(placement.endsWith('rewarded') ? { lastRewardedAt: now } : {}),
      ...(placement === 'expense_interstitial' ? { lastInterstitialAt: now } : {}),
    });
  }
  const event: PendingEvent = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    placement,
    outcome,
  };
  // Persist before sending. A temporary connection failure is retried on the next
  // event/status read. An account change never attributes an old event to a new user.
  queue = queue
    .then(async () => {
      const key = `waves.adEvents.${profileId}`;
      const rows = JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as PendingEvent[];
      rows.push(event);
      await AsyncStorage.setItem(key, JSON.stringify(rows));
      await flush(profileId);
    })
    .catch(() => undefined);
}
async function flush(profileId: string) {
  const key = `waves.adEvents.${profileId}`;
  const rows = JSON.parse((await AsyncStorage.getItem(key)) ?? '[]') as PendingEvent[];
  while (rows.length) {
    const row = rows[0]!;
    const result = await adTimeout(
      backend.rpc('waves_log_ad_event', {
        p_placement: row.placement,
        p_outcome: row.outcome,
        p_event_id: row.id,
        p_occurred_at: row.createdAt,
        p_profile: profileId,
      }),
    );
    if (!result || result.error) return;
    rows.shift();
    await AsyncStorage.setItem(key, JSON.stringify(rows));
  }
}
export async function flushAdEvents(profileId: string) {
  queue = queue.then(() => flush(profileId)).catch(() => undefined);
  await queue;
}
