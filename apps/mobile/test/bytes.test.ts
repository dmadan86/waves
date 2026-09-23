import { describe, expect, it } from 'vitest';

import { formatBytes } from '../src/lib/bytes';

const MB = 1024 * 1024;

describe('a size a person reads', () => {
  it('counts anything under a megabyte in whole binary kilobytes', () => {
    expect(formatBytes(1024, 'en')).toBe('1 KB');
    expect(formatBytes(1536, 'en')).toBe('2 KB');
    expect(formatBytes(700 * 1024, 'en')).toBe('700 KB');
  });

  it('keeps one decimal for small megabyte sizes and drops it from ten up', () => {
    expect(formatBytes(5.5 * MB, 'en')).toBe('5.5 MB');
    expect(formatBytes(5 * MB, 'en')).toBe('5 MB');
    expect(formatBytes(25.6 * MB, 'en')).toBe('26 MB');
  });

  it('says nothing stored as megabytes, not as an empty kilobyte count', () => {
    expect(formatBytes(0, 'en')).toBe('0 MB');
  });

  it('formats the number the way the chosen locale writes it', () => {
    expect(formatBytes(5.5 * MB, 'de')).toBe('5,5 MB');
  });
});
