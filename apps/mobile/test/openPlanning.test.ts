import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openPlanning, PLANNING_ROUTE, planningHref } from '@/lib/openPlanning';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/navigation', () => ({ router: { navigate } }));

describe('openPlanning', () => {
  beforeEach(() => navigate.mockClear());

  it('maps each segment to its Planning route', () => {
    expect(planningHref('recurring')).toBe('/personal/recurring');
    expect(planningHref('budgets')).toBe('/personal/budgets');
    expect(planningHref('loans')).toBe('/personal/loans');
  });

  it('keeps params, and drops an empty params object', () => {
    expect(planningHref('budgets', { category: 'food', limit: '100' })).toEqual({
      pathname: '/personal/budgets',
      params: { category: 'food', limit: '100' },
    });
    expect(planningHref('loans', {})).toBe('/personal/loans');
  });

  it('opens the segment through one guarded navigate, never a stacked push', () => {
    openPlanning('loans');
    openPlanning('budgets', { category: 'food' });
    expect(navigate).toHaveBeenNthCalledWith(1, '/personal/loans');
    expect(navigate).toHaveBeenNthCalledWith(2, {
      pathname: '/personal/budgets',
      params: { category: 'food' },
    });
  });

  it('covers exactly the three switch segments', () => {
    expect(Object.keys(PLANNING_ROUTE)).toEqual(['recurring', 'budgets', 'loans']);
  });
});

/** Guard: nothing links to Recurring, Budgets or Loans except through openPlanning/planningHref. */
const SRC = join(process.cwd(), 'src');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROUTE = /['"`]\/personal\/(budgets|loans|recurring)['"`?]/;
// The route table itself, the bar (it IS the tab), the file-router stack, and data that is
// only consumed through openPlanning (the assistant's "Set one" link).
const ALLOWED = new Set([
  'lib/openPlanning.ts',
  'lib/tabBar.ts',
  'app/_layout.tsx',
  'lib/assistantAnswers.ts',
]);

describe('Planning links guard', () => {
  it('no code names a Planning route directly; use openPlanning(segment)', () => {
    const offenders: string[] = [];
    for (const path of sources(SRC)) {
      const rel = relative(SRC, path);
      if (ALLOWED.has(rel)) continue;
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // returnTo is where a sub-page comes back to, not a link into Planning.
          if (ROUTE.test(line) && !/returnTo/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
