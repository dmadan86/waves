import { randomUUID } from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { adTimeout } from '@/lib/adTimeout';
import { backend } from '@/lib/backend';
import { looksAdBlocked } from './adPacingPure';

export type AdPlacement =
  | 'expense_interstitial'
  | 'group_create_rewarded'
  | 'export_rewarded'
  | 'native_list'
  | 'quota_rewarded';
export type AdEventOutcome =
  | 'shown'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'blocked_grace'
  | 'offline_allowed'
  | 'owed_offered'
  | 'owed_declined'
  | 'blocked_adblock'
  | 'credit_used'
  | 'credit_earned'
  | 'offline_capped';
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
  detail?: string;
}
// Why the last ad attempt failed (SDK error code/message), attached to the next 'failed' event.
let lastFailure: string | undefined;
let pendingFailure = false;
export function lastFailureText(): string {
  return lastFailure ?? '';
}
/** Before a new attempt, so a stale reason is never read as this attempt's. */
export function clearAdFailure(): void {
  lastFailure = undefined;
  pendingFailure = false;
  lastBlocked = false;
}
export function noteAdFailure(reason: unknown): void {
  const e = reason as { code?: unknown; message?: unknown } | null;
  lastFailure = String(e?.code ?? '') + ' ' + String(e?.message ?? reason ?? '');
  lastFailure = lastFailure.trim().slice(0, 200);
  lastBlocked = looksAdBlocked(lastFailure);
  pendingFailure = true;
}
let lastBlocked = false;
/** Whether the latest failed ad looked blocked, for the gate sheet's copy. */
export function lastFailureWasBlocked(): boolean {
  return lastBlocked;
}
let queue = Promise.resolve();
export function logAdEvent(
  profileId: string,
  placement: AdPlacement,
  outcome: AdEventOutcome,
  detail?: string,
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
    ...(outcome === 'failed' && pendingFailure && lastFailure ? { detail: lastFailure } : {}),
    ...(detail !== undefined ? { detail: detail.slice(0, 200) } : {}),
  };
  if (outcome === 'failed') pendingFailure = false;
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
        ...(row.detail !== undefined ? { p_detail: row.detail } : {}),
      }),
    );
    if (!result) return;
    if (
      result.error &&
      result.error.code !== '23514' &&
      !/ad_events_outcome_check|check constraint/i.test(result.error.message ?? '')
    )
      return;
    rows.shift();
    await AsyncStorage.setItem(key, JSON.stringify(rows));
  }
}
export async function flushAdEvents(profileId: string) {
  queue = queue.then(() => flush(profileId)).catch(() => undefined);
  await queue;
}
