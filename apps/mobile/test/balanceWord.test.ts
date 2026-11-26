import { describe, expect, it } from 'vitest';

import { balanceWord } from '@/lib/groupBalanceList';

const words = {
  youAreOwed: 'you are owed',
  youOwe: 'you owe',
  isOwed: 'is owed',
  owes: 'owes',
  allSquare: 'all square',
};

describe('balanceWord', () => {
  it('speaks to you on your row and about them on everyone else', () => {
    expect(balanceWord(70n, true, words)).toBe('you are owed');
    expect(balanceWord(-70n, true, words)).toBe('you owe');
    // Somebody owed by the group is not somebody you owe.
    expect(balanceWord(70n, false, words)).toBe('is owed');
    expect(balanceWord(-70n, false, words)).toBe('owes');
    expect(balanceWord(0n, false, words)).toBe('all square');
  });
});
