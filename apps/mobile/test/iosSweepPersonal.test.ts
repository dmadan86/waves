import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { personalActiveKey } from '../src/lib/tabBar';

const src = (p: string) => readFileSync(join(import.meta.dirname, '../src', p), 'utf8');

describe('iOS sweep fixes (Personal)', () => {
  it('Upcoming highlights Planning, like its siblings', () => {
    expect(personalActiveKey(['personal', 'upcoming'])).toBe('planning');
  });
  it('Budgets uses the shared Planning header', () => {
    expect(src('app/personal/budgets.tsx')).toContain('<PlanningHeader');
  });
  it('quick-action labels wrap instead of shrinking', () => {
    expect(src('components/home/QuickActionsRow.tsx')).not.toContain('adjustsFontSizeToFit');
  });
  it('setup keeps its step header outside the scroll view', () => {
    const s = src('app/personal/setup.tsx');
    expect(s.indexOf('<StepHeader')).toBeLessThan(s.indexOf('<ScrollView'));
  });
});
