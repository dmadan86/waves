import { describe, expect, it } from 'vitest';

import { defaultDestination, quickSummary } from '../src/lib/quickExpense';
import { quickAdds } from '../src/lib/amountStep';

describe('quick expense rules', () => {
  it('defaults to the most recent group, then Just me, then nothing', () => {
    expect(defaultDestination(['g1', 'g2'], true)).toBe('g1');
    expect(defaultDestination([], true)).toBe('personal');
    expect(defaultDestination([], false)).toBeNull();
  });

  it('fills the member count into the summary', () => {
    expect(quickSummary('Split equally between {count} · You paid', 3)).toBe(
      'Split equally between 3 · You paid',
    );
  });

  it('scales the chips to the currency', () => {
    expect(quickAdds(0n, 'INR')).toEqual([500n, 1000n, 5000n, 10000n]);
    expect(quickAdds(0n, 'JPY').every((add) => add > 0n)).toBe(true);
  });
});
