import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { backend } from '@/lib/backend';
import { adTimeout } from '@/lib/adTimeout';
import { parseCredits, parseSpend, type CreditKind } from './adCreditsPure';
export async function readCredits() {
  try {
    const result = await adTimeout(backend.rpc('waves_my_credits'));
    return result && !result.error ? parseCredits(result.data) : null;
  } catch {
    return null;
  }
}
/**
 * For `['credits', viewerId]` queries. Each good read is kept on the phone, so a failed or
 * slow refresh (and a cold start offline) shows the last known balance instead of none.
 */
export async function queryCredits({ queryKey }: { queryKey: readonly unknown[] }) {
  const key = `credits:last:${String(queryKey[1])}`;
  const credits = await readCredits();
  if (credits) {
    void AsyncStorage.setItem(key, JSON.stringify(credits)).catch(() => {});
    return credits;
  }
  const saved = await AsyncStorage.getItem(key).catch(() => null);
  if (saved) return JSON.parse(saved) as NonNullable<typeof credits>;
  // Throwing keeps whatever the cache already holds.
  throw new Error('credits unavailable');
}
export async function spendCredits(kind: CreditKind) {
  try {
    const result = await adTimeout(
      backend.rpc('waves_spend_credits', { p_kind: kind, p_event_id: randomUUID() }),
    );
    return result && !result.error ? parseSpend(result.data) : null;
  } catch {
    return null;
  }
}
