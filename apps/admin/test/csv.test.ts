import { describe, expect, it } from 'vitest';
import { cell } from '@/lib/csv';

describe('CSV cells', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@SUM(A1)', '\tformula', '\rformula'])(
    'neutralizes string formula %j',
    (value) => {
      expect(cell(value)).toBe(`"'${value}"`);
    },
  );
  it('preserves numbers, bigints, nulls, and RFC 4180 escaping', () => {
    expect(cell(-123)).toBe('"-123"');
    expect(cell(-123n)).toBe('"-123"');
    expect(cell(null)).toBe('""');
    expect(cell(undefined)).toBe('""');
    expect(cell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(cell('=A1&"x"')).toBe('"\'=A1&""x"""');
  });
});
