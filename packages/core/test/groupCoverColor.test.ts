import { describe, expect, it } from 'vitest';

import {
  GROUP_COVER_COLORS,
  GROUP_COVER_COLOR_SHAPE,
  isGroupCoverColor,
  normaliseGroupCoverColor,
} from '../src/index';

describe('group cover colour keys', () => {
  it('offers eighteen distinct keys, every one a shape the column accepts', () => {
    expect(GROUP_COVER_COLORS).toHaveLength(18);
    expect(new Set(GROUP_COVER_COLORS).size).toBe(18);
    for (const key of GROUP_COVER_COLORS) expect(key).toMatch(GROUP_COVER_COLOR_SHAPE);
  });

  it('reads only known keys, tolerating case and padding', () => {
    expect(isGroupCoverColor('peach')).toBe(true);
    expect(isGroupCoverColor('#ffaa00')).toBe(false);
    expect(isGroupCoverColor(null)).toBe(false);
    expect(normaliseGroupCoverColor('  Peach ')).toBe('peach');
    expect(normaliseGroupCoverColor('chartreuse')).toBeNull();
    expect(normaliseGroupCoverColor(7)).toBeNull();
  });

  it('keeps the shape regex out of hex and junk', () => {
    expect(GROUP_COVER_COLOR_SHAPE.test('#fff')).toBe(false);
    expect(GROUP_COVER_COLOR_SHAPE.test('Peach')).toBe(false);
    expect(GROUP_COVER_COLOR_SHAPE.test('')).toBe(false);
  });
});
