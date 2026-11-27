import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { personalShowsAddFab } from '../src/lib/personalLayoutRules';
import { personalActiveKey } from '../src/lib/tabBar';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

describe('iOS sweep fixes (Personal)', () => {
  it('Ask has no floating +', () => {
    expect(personalShowsAddFab(['personal', 'ask'])).toBe(false);
  });
  it('Upcoming highlights Planning, like its siblings', () => {
    expect(personalActiveKey(['personal', 'upcoming'])).toBe('planning');
  });
  it('Budgets uses the shared PlainHeader', () => {
    expect(src('app/personal/budgets.tsx')).toContain('<PlainHeader');
  });
  it('quick-action labels wrap instead of shrinking', () => {
    expect(src('components/home/QuickActionsRow.tsx')).not.toContain('adjustsFontSizeToFit');
  });
  it('setup keeps its step header outside the scroll view', () => {
    const s = src('app/personal/setup.tsx');
    expect(s.indexOf('<StepHeader')).toBeLessThan(s.indexOf('<ScrollView'));
  });
});
