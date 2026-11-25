import { describe, expect, it } from 'vitest';

import { needsName } from '../src/lib/needsName';

describe('needs a name after sign-in', () => {
  it('asks when the name is missing or the Guest placeholder', () => {
    expect(needsName(null)).toBe(true);
    expect(needsName(undefined)).toBe(true);
    expect(needsName('  ')).toBe(true);
    expect(needsName('Guest')).toBe(true);
  });
  it('leaves a chosen name alone', () => {
    expect(needsName('Ravi')).toBe(false);
    expect(needsName('Guesty')).toBe(false);
  });
});
