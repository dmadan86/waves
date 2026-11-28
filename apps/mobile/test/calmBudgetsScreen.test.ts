import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../src/app/personal/budgets.tsx'), 'utf8');
const i18n = readFileSync(join(__dirname, '../src/i18n/index.ts'), 'utf8');

describe('calm Budgets screen', () => {
  it('keeps the shared Planning header and switch', () => {
    expect(src).toMatch(/<PlanningHeader/);
    expect(src).toMatch(/<PlanningTabs value="budgets"/);
  });
  it('shows one summary card, one sentence, a Spending nudge and sorted flat rows', () => {
    expect(src).toMatch(/<SummaryCard/);
    expect(src).toMatch(/summarySentence/);
    expect(src).toMatch(/<NudgeRow/);
    expect(src).toMatch(/sortCategories\(/);
    expect(src).toMatch(/c\.rowOver/);
    expect(src).toMatch(/c\.rowLeft/);
  });
  it('drops the ring, gradient and pill badges', () => {
    expect(src).not.toMatch(/BudgetRing|LinearGradient|borderRadius: theme\.radius\.pill/);
  });
  it('has the new strings in all languages', () => {
    expect(i18n.match(/^ {4}rowOver: /gm)).toHaveLength(5);
  });
});
