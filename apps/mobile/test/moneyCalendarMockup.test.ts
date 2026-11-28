import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The owner's mockup: round back + big title/subtitle + filled "+", a chip row with icons,
// a day summary ("2 items • total") and a bordered card per item.
const src = readFileSync(join(__dirname, '../src/components/home/MoneyCalendar.tsx'), 'utf8');

describe('money calendar mockup', () => {
  it('has a subtitle and a header + that adds a due date', () => {
    expect(src).toMatch(/c\.calendarSub/);
    expect(src).toMatch(/accessibilityLabel=\{c\.addDueDate\}/);
    expect(src).toMatch(/addBillRoute\(groupId\)/);
  });
  it('has the five filter chips with icons, never truncated', () => {
    for (const f of ['all', 'bills', 'loans', 'renewals', 'income']) {
      expect(src).toContain(`value: '${f}'`);
    }
    expect(src).toMatch(/layers-outline/);
    expect(src).not.toMatch(/numberOfLines=\{1\}[^>]*>\s*\{ch\.label\}/);
  });
  it('summarises the selected day with a count and total', () => {
    expect(src).toMatch(/c\.dayItems/);
    expect(src).toMatch(/dayTotal/);
  });
  it('shows an action pill only when the item has an action', () => {
    expect(src).toMatch(/action \?/);
  });
});
