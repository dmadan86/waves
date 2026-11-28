import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner: the pastel To collect / To pay blocks looked bad; keep the earlier
// look (round ↑/↓ icons, two halves with a divider on the white card).
describe('Home hero look', () => {
  const src = readFileSync(join(__dirname, '../src/components/home/CollectPayTiles.tsx'), 'utf8');
  it('draws the sides with the icon-disc BalanceSide', () => {
    expect(src).toMatch(/<BalanceSide[\s\S]*iconDisc/);
  });
  it('has no filled pastel tiles', () => {
    expect(src).not.toMatch(/backgroundColor:\s*soft/);
  });
});
