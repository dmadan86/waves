import { describe, expect, it } from 'vitest';

import { parseVoiceExpenses } from '@/lib/voiceExpense';

// "split between four people" names nobody: a head count, said in words.
describe('a spoken head count with no names', () => {
  it.each([
    'I paid ₹1,200 for dinner, split between four people',
    'I paid ₹1,200 for dinner, split between four',
    'dinner 1200 split four ways',
    'dinner 1200 split equally among four of us',
  ])('%s', (said) => {
    const result = parseVoiceExpenses(said, []);
    expect(result.splitCount).toBe(4);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.amountMinor).toBe(120000n);
    expect(result.peopleText ?? '').not.toMatch(/four/);
  });
});
