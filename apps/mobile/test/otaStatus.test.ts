import { describe, expect, it } from 'vitest';

import { describeUpdate, formatUpdateDate, shortUpdateId } from '@/lib/otaStatus';

const labels = { builtIn: 'Built-in', overTheAir: 'Over-the-air' };

describe('the app-updates line', () => {
  it('says built-in for the bundle that shipped with the binary', () => {
    expect(describeUpdate({ embedded: true, updateId: null, createdAt: null }, labels)).toBe(
      'Built-in',
    );
  });

  it('names the update and its date when running over the air', () => {
    expect(
      describeUpdate(
        {
          embedded: false,
          updateId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          createdAt: new Date('2026-11-10T10:00:00Z'),
        },
        labels,
      ),
    ).toBe('Over-the-air · 1a2b3c4d · 2026-11-10');
  });

  it('drops what is unknown instead of leaving a stray separator', () => {
    expect(describeUpdate({ embedded: false, updateId: null, createdAt: null }, labels)).toBe(
      'Over-the-air',
    );
    expect(shortUpdateId(undefined)).toBe('');
    expect(formatUpdateDate(new Date('nope'))).toBe('');
  });
});
