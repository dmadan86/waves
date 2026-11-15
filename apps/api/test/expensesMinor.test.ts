import { describe, expect, it } from 'vitest';
import { minor } from '../src/routes/v1/expenses';

describe('expense minor units', () => {
  it('accepts up to 15 digits and preserves zero behavior', () => {
    expect(minor('999999999999999', 'amount')).toBe(999999999999999n);
    expect(minor('0', 'amount')).toBe(0n);
    expect(minor('000', 'amount')).toBe(0n);
  });
  it.each(['1000000000000000', '9999999999999999999', '-1', '1.5', '', 1, null])(
    'refuses invalid amount %j with a 400',
    (value) => {
      expect(() => minor(value, 'amount')).toThrow(
        expect.objectContaining({
          code: 'invalid_request',
          status: 400,
          message: expect.stringContaining('at most 15 digits'),
        }),
      );
    },
  );
});
