import { describe, expect, it } from 'vitest';

import { parseLimit, validAccrual } from '../src/lib/company/leaveFields';

describe('leave policy fields', () => {
  it('parses limits: empty is no limit, bad is undefined', () => {
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('2,5')).toBe(2.5);
    expect(parseLimit('-1')).toBeUndefined();
    expect(parseLimit('367')).toBeUndefined();
    expect(parseLimit('x')).toBeUndefined();
  });
  it('accrual is 0 to 5 in halves or quarters', () => {
    expect(validAccrual(1.5)).toBe(true);
    expect(validAccrual(5.5)).toBe(false);
    expect(validAccrual(1.1)).toBe(false);
    expect(validAccrual(null)).toBe(false);
  });
});
