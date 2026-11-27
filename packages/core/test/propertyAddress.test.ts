import { describe, expect, it } from 'vitest';

import { decodeProperty, encodeProperty } from '../src/personal/types';

describe('property address', () => {
  it('round-trips the address and keeps unknown fields', () => {
    const p = decodeProperty('p1', {
      type: 'house',
      name: 'Flat',
      address: '12 Main St',
      future: 1,
    });
    expect(p.address).toBe('12 Main St');
    const { id: _id, ...rest } = p;
    const out = encodeProperty({ ...rest, address: null });
    expect(out.address).toBeNull();
    expect(out.future).toBe(1);
    expect(decodeProperty('p1', {}).address).toBeNull();
  });
});
