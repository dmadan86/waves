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
  it('the quick action reads Groups with a people icon, not Remind', () => {
    const qa = readFileSync(join(__dirname, '../src/components/home/HomeQuickActions.tsx'), 'utf8');
    expect(qa).toContain('label: t.groupsTitle');
    expect(qa).not.toContain('label: t.people.remind');
  });
});
