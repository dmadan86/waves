import { describe, expect, it } from 'vitest';

import { ringColors } from '../src/components/home/ringColors';

const theme = { color: { border: '#ddd', brand: '#0B63C5' } };

describe('ringColors', () => {
  it('on the photo: white arc on a dark track so progress shows', () => {
    expect(ringColors(false, theme)).toEqual({ track: 'rgba(0,0,0,0.35)', arc: '#FFFFFF' });
  });
  it('on a solid header: brand arc on the border track', () => {
    expect(ringColors(true, theme)).toEqual({ track: '#ddd', arc: '#0B63C5' });
  });
});
