/**
 * What this phone remembers about its plan notifications: the three switches,
 * and a small history of what it scheduled and what got tapped (nothing in
 * `expo-notifications` reports a delivery, so "went off" is inferred from a fire
 * time in the past). Device-local and owner-scoped, like `captureNudge/settings`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PLAN_PREFS, type PlanHistory, type PlanPrefs } from './plan';

const PREF_KEY = 'waves.plan_nudge.pref';
const SCHEDULED_KEY = 'waves.plan_nudge.scheduled';
const OPENED_KEY = 'waves.plan_nudge.opened';
const KEEP = 20;

const scoped = (base: string, ownerId: string): string => `${base}.${ownerId}`;

export async function loadPlanPrefs(ownerId: string): Promise<PlanPrefs> {
  if (!ownerId) return { bills: false, recap: false, daily: false };
  const read = async (name: keyof PlanPrefs): Promise<boolean> => {
    const stored = await AsyncStorage.getItem(scoped(`${PREF_KEY}.${name}`, ownerId)).catch(
      () => null,
    );
    return stored === null ? DEFAULT_PLAN_PREFS[name] : stored === 'yes';
  };
  const [bills, recap, daily] = await Promise.all([read('bills'), read('recap'), read('daily')]);
  return { bills, recap, daily };
}

export async function savePlanPref(
  ownerId: string,
  name: keyof PlanPrefs,
  value: boolean,
): Promise<void> {
  if (!ownerId) return;
  await AsyncStorage.setItem(scoped(`${PREF_KEY}.${name}`, ownerId), value ? 'yes' : 'no');
}

async function readTimes(key: string): Promise<number[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(key)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}

async function addTimes(key: string, times: readonly number[]): Promise<void> {
  const merged = [...new Set([...(await readTimes(key)), ...times])].sort((a, b) => a - b);
  await AsyncStorage.setItem(key, JSON.stringify(merged.slice(-KEEP))).catch(() => {});
}

export async function loadPlanHistory(ownerId: string): Promise<PlanHistory> {
  if (!ownerId) return { scheduled: [], opened: [] };
  const [scheduled, opened] = await Promise.all([
    readTimes(scoped(SCHEDULED_KEY, ownerId)),
    readTimes(scoped(OPENED_KEY, ownerId)),
  ]);
  return { scheduled, opened };
}

export async function recordPlanScheduled(
  ownerId: string,
  fireAts: readonly number[],
): Promise<void> {
  if (ownerId) await addTimes(scoped(SCHEDULED_KEY, ownerId), fireAts);
}

/** A plan notification was tapped. */
export async function recordPlanOpened(ownerId: string, fireAt: number): Promise<void> {
  if (ownerId && Number.isFinite(fireAt)) await addTimes(scoped(OPENED_KEY, ownerId), [fireAt]);
}

/** On the way out of an account. Best effort. */
export async function clearPlanNudge(ownerId: string): Promise<void> {
  if (!ownerId) return;
  const keys = [
    ...(['bills', 'recap', 'daily'] as const).map((n) => `${PREF_KEY}.${n}`),
    SCHEDULED_KEY,
    OPENED_KEY,
  ];
  await Promise.all(keys.map((k) => AsyncStorage.removeItem(scoped(k, ownerId)).catch(() => {})));
}
