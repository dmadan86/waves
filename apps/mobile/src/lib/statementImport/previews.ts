/**
 * The Free teaser's allowance: two statement previews a calendar month.
 *
 * Counted on the device. A preview is read on the phone with no model and no
 * server call, so there is nothing for a server to enforce; a Free person who
 * clears the app's data gets two more previews of their own statement, which is
 * not worth a mechanism.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { FREE_MONTHLY_STATEMENT_PREVIEWS } from '@waves/core';

const KEY = 'waves.statementPreviews.v1';

interface Stored {
  readonly month: string;
  readonly used: number;
}

/** `YYYY-MM` of a date. */
export const monthOf = (date: Date): string => date.toISOString().slice(0, 7);

/** Pure: previews left in `month` given what was stored. */
export function previewsLeft(stored: Stored | null, month: string): number {
  const used = stored && stored.month === month ? stored.used : 0;
  return Math.max(0, FREE_MONTHLY_STATEMENT_PREVIEWS - used);
}

async function read(): Promise<Stored | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return typeof parsed.month === 'string' && typeof parsed.used === 'number'
      ? { month: parsed.month, used: parsed.used }
      : null;
  } catch {
    return null;
  }
}

export async function statementPreviewsLeft(now = new Date()): Promise<number> {
  return previewsLeft(await read(), monthOf(now));
}

/** Spend one preview. Best effort: a storage failure never blocks the teaser. */
export async function spendStatementPreview(now = new Date()): Promise<void> {
  const month = monthOf(now);
  const stored = await read();
  const used = (stored && stored.month === month ? stored.used : 0) + 1;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ month, used }));
  } catch {
    // Nothing to do: the teaser still shows.
  }
}
