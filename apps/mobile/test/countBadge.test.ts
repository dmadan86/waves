import { describe, expect, it } from 'vitest';
import { badgeLabel } from '../src/lib/countBadge';

describe('badgeLabel', () => {
  it('hides at zero or below', () => {
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(-3)).toBeNull();
    expect(badgeLabel(undefined)).toBeNull();
  });
  it('shows the number, capped at 99+', () => {
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(48)).toBe('48');
    expect(badgeLabel(99)).toBe('99');
    expect(badgeLabel(100)).toBe('99+');
  });
});
