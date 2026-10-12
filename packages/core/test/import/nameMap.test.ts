import { describe, expect, it } from 'vitest';

import { draftFromText } from '../../src/import/draft';
import { nameMap } from '../../src/import/nameMap';

describe('names from a file never reach Object.prototype', () => {
  it('keeps __proto__ as an ordinary key', () => {
    const map = nameMap<bigint>();
    map['__proto__'] = 5n;
    expect(Object.keys(map)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reads a person called __proto__ without polluting', () => {
    const csv =
      'Date,Description,Amount,Paid by,Split between\n2026-10-01,Tea,100,__proto__,"__proto__; Asha"\n';
    draftFromText(csv);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'Asha')).toBe(false);
  });
});
