import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { familyTileHref } from '@/lib/homeTiles';

describe('Home My money + Family tiles', () => {
  it('Family opens the one family space, or the groups list when there are several', () => {
    expect(familyTileHref([])).toBeNull();
    expect(familyTileHref(['c1'])).toBe('/group/c1');
    expect(familyTileHref(['c1', 'h2'])).toBe('/groups');
  });

  it('draws My money and Family as side-by-side tiles; family rows join Groups', () => {
    const src = readFileSync(join(__dirname, '../src/components/home/HomeSpaces.tsx'), 'utf8');
    expect(src).toContain('<MoneyTile');
    expect(src).not.toMatch(/title:\s*h\.family,\s*rows:\s*family/);
  });
});
