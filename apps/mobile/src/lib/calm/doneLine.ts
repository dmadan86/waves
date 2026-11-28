/** "✓ Netflix ₹649 paid yesterday": bills posted in the last two days, as one quiet line. */

import type { PersonalTxn } from '@waves/core';

import { addDays } from './weekPace';

export interface Done {
  readonly count: number;
  /** The most recent one, for the single-bill sentence. */
  readonly latest: PersonalTxn;
  readonly when: 'today' | 'yesterday';
}

export function recentlyPaid(txns: readonly PersonalTxn[], today: string): Done | null {
  const from = addDays(today, -1);
  const paid = txns
    .filter((t) => t.kind === 'expense' && t.recurringId && t.date >= from && t.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  const latest = paid[0];
  if (!latest) return null;
  return { count: paid.length, latest, when: latest.date === today ? 'today' : 'yesterday' };
}
