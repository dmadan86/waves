import { describe, expect, it } from 'vitest';

import { greetingLine } from '@/lib/greetingLine';

describe('greetingLine', () => {
  it('adds the first name', () => {
    expect(greetingLine('Good afternoon', 'madan dei', 'en')).toBe('Good afternoon, Madan');
  });
  it('drops the comma without a name', () => {
    expect(greetingLine('Good afternoon', null, 'en')).toBe('Good afternoon');
    expect(greetingLine('Good afternoon', '  ', 'en')).toBe('Good afternoon');
  });
  it('uses the Arabic comma', () => {
    expect(greetingLine('مساء الخير', 'Madan', 'ar')).toBe('مساء الخير، Madan');
  });
});
