import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner ask: Home hero "Remind" opens the Groups list, not the Friends tab.
describe('Home Remind', () => {
  it('opens the Groups list', () => {
    const src = readFileSync(join(__dirname, '../src/app/(tabs)/index.tsx'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('onRemind='));
    expect(line).toContain("router.navigate('/groups')");
  });
});
