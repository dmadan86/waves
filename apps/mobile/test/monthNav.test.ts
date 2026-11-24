import { describe, expect, it } from 'vitest';

import { monthsBetween, shiftMonth } from '../src/lib/monthNav';

describe('monthNav', () => {
  it('shifts across year ends', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
    expect(shiftMonth('2026-03', 0)).toBe('2026-03');
  });
  it('counts whole months', () => {
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
    expect(monthsBetween('2026-02', '2025-11')).toBe(-3);
  });
});
