import { describe, expect, it, vi } from 'vitest';

import { displayPhone } from '../src/lib/phone';

vi.mock('@/i18n', () => ({ deviceCountry: () => 'IN' }));

describe('displayPhone', () => {
  it('groups an Indian number the way it is read', () => {
    expect(displayPhone('919901511077')).toBe('+91 99015 11077');
    expect(displayPhone('+91 99015-11077')).toBe('+91 99015 11077');
  });

  it('groups a North American number', () => {
    expect(displayPhone('14155550100')).toBe('+1 415 555 0100');
  });

  it('gives anything else its country code and the rest', () => {
    expect(displayPhone('971501234567')).toBe('+971501234567');
  });

  it('is empty for nothing', () => {
    expect(displayPhone(null)).toBe('');
    expect(displayPhone('')).toBe('');
  });
});
