import { describe, expect, it } from 'vitest';

import { balanceWord } from '@/lib/groupBalanceList';

const words = {
  youAreOwed: 'you are owed',
  youOwe: 'you owe',
  owesYou: 'owes you',
  youOweThem: 'you owe them',
  allSquare: 'all square',
};

describe('balanceWord', () => {
  it('reads each row from the viewer side', () => {
    expect(balanceWord(70n, true, words)).toBe('you are owed');
    expect(balanceWord(-70n, false, words)).toBe('owes you');
    expect(balanceWord(70n, false, words)).toBe('you owe them');
    expect(balanceWord(-70n, true, words)).toBe('you owe');
    expect(balanceWord(0n, false, words)).toBe('all square');
  });
});
