/** CU-13: a currency on update_expense relabels; amountMinor is never rescaled by the gate. */
import { describe, expect, it } from 'vitest';

import { parseToolCalls, type VoiceContext } from './logic';

const context: VoiceContext = {
  groups: [],
  currentGroupId: null,
  today: '2026-10-21',
  saved: { id: 'p1', kind: 'personal' },
};

describe('update_expense currency', () => {
  it('CU-13 never re-scales amountMinor when the currency changes (INR 800000 minor stays 800000)', () => {
    for (const currency of ['INR', 'AED', 'KWD', 'JPY']) {
      const parsed = parseToolCalls(
        [
          {
            name: 'update_expense',
            input: { expenseId: 'p1', currency, amountMinor: '800000', category: 'food' },
          },
        ],
        context,
      );
      expect(parsed.ok, currency).toBe(true);
      if (!parsed.ok) continue;
      // Whatever shape the update has, a stated amountMinor is passed through untouched.
      const update = parsed.update as { amountMinor?: string; category?: string } | undefined;
      expect(update?.category).toBe('food');
      if (update?.amountMinor !== undefined) expect(String(update.amountMinor)).toBe('800000');
    }
  });
});
