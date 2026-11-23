/**
 * What the Personal home remembers about its plan cards, on this phone only:
 * which save tips were put off ("Not now", for a week) and which recaps were
 * opened. Per account, like the other intro flags. Nothing here rejects.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const TIP_PAUSE_MS = 7 * 86_400_000;
const tipSlot = (ownerId: string): string => `waves.plan_tips_paused.${ownerId}`;
const recapSlot = (ownerId: string): string => `waves.plan_recaps_opened.${ownerId}`;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Forgetting a dismissal is cheaper than failing the screen.
  }
}

/** The tip keys still paused at `now` (epoch ms). */
export async function pausedTips(ownerId: string, now: number): Promise<Set<string>> {
  const until = await readJson<Record<string, number>>(tipSlot(ownerId), {});
  return new Set(Object.keys(until).filter((k) => (until[k] ?? 0) > now));
}

/** Put a tip off for 7 days. */
export async function pauseTip(ownerId: string, tipKey: string, now: number): Promise<void> {
  const until = await readJson<Record<string, number>>(tipSlot(ownerId), {});
  const live = Object.fromEntries(Object.entries(until).filter(([, v]) => v > now));
  await writeJson(tipSlot(ownerId), { ...live, [tipKey]: now + TIP_PAUSE_MS });
}

/** Recap ids (`week:2026-11-16`, `month:2026-10`) already opened. */
export const openedRecaps = (ownerId: string): Promise<string[]> =>
  readJson<string[]>(recapSlot(ownerId), []);

export async function markRecapOpened(ownerId: string, recapId: string): Promise<void> {
  const seen = await openedRecaps(ownerId);
  if (!seen.includes(recapId)) await writeJson(recapSlot(ownerId), [...seen, recapId].slice(-24));
}
