/**
 * The Spending screen is mostly visual, but its route and affordance contract is
 * easy to break without a type error: the Me tab must lead to it, the chart bars
 * must be named for assistive tech, and the split rows must stay plain until the
 * ledger can filter them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const source = (path: string): string => readFileSync(join(SRC, path), 'utf8');

describe('personal spending screen route and affordances', () => {
  it('is opened from both Me-tab spending affordances', () => {
    const me = source('app/(tabs)/me.tsx');

    expect(me.match(/router\.push\('\/personal\/spending'\)/g)).toHaveLength(2);
  });

  it('names every chart column for screen readers', () => {
    const spending = source('app/personal/spending.tsx');

    expect(spending).toContain('accessibilityRole="button"');
    expect(spending).toContain('accessibilityState={{ selected: isSelected }}');
    expect(spending).toContain('${earnedLabel} ${accessibleAmount(');
    expect(spending).toContain('${spentLabel} ${accessibleAmount(');
  });

  it('keeps split rows non-interactive until the ledger can filter them', () => {
    const spending = source('app/personal/spending.tsx');
    const start = spending.indexOf('function SplitRow(');
    const end = spending.indexOf('function StepButton(', start);
    const splitRow = spending.slice(start, end);

    expect(splitRow).not.toContain('<Pressable');
    expect(spending).toContain('When that list learns to filter, this row is where the tap');
  });
});
