import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../src/app/rentals/[id].tsx'), 'utf8');

describe('rental property actions', () => {
  it('render above the rent-due hero, not pinned at the bottom', () => {
    expect(src.indexOf('label={w.addExpense}')).toBeGreaterThan(0);
    expect(src.indexOf('label={w.addExpense}')).toBeLessThan(src.indexOf('w.rentDueCap'));
    expect(src.indexOf('label={w.receiptsBtn}')).toBeLessThan(src.indexOf('w.rentDueCap'));
    expect(src).not.toContain('paddingBottom: clearance + theme.spacing.sm');
  });

  it('keeps the bottom clearance on the scroll content', () => {
    expect(src).toContain('paddingBottom: clearance + theme.spacing.lg');
  });
});
