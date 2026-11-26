import { describe, expect, it } from 'vitest';

import { ownRailHint } from '../src/lib/ownRailHint';

describe('ownRailHint', () => {
  it('speaks to the owner of the page', () => {
    expect(ownRailHint('Their UPI ID, like ravi@okhdfcbank')).toBe(
      'Your UPI ID, like ravi@okhdfcbank',
    );
    expect(ownRailHint('The mobile number or email on their Zelle')).toBe(
      'The mobile number or email on your Zelle',
    );
  });
});
