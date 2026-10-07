import { describe, expect, it } from 'vitest';

import { namesSoundAlike, resolveSpokenName } from '../src/voice/names';

describe('names a phone recogniser mishears as words', () => {
  it('hears "rainy" as Renny', () => {
    expect(namesSoundAlike('rainy', 'renny')).toBe(true);
    expect(namesSoundAlike('raini', 'renny')).toBe(true);
  });

  it('still keeps unrelated words apart', () => {
    expect(namesSoundAlike('rainy', 'ravi')).toBe(false);
    expect(namesSoundAlike('any', 'renny')).toBe(false);
  });

  it('resolves "rainy" to Renny among the group', () => {
    const result = resolveSpokenName('rainy', [
      { id: 'r', name: 'Renny Benita' },
      { id: 'v', name: 'Ravi' },
      { id: 'a', name: 'Anu' },
    ]);
    expect(result).toMatchObject({ status: 'resolved', id: 'r', fuzzy: true });
  });
});
