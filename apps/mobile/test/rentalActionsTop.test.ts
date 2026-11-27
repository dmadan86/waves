import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../src/app/rentals/[id].tsx'), 'utf8');

describe('rental property actions', () => {
  it('render above the rent-due hero, not pinned at the bottom', () => {
    expect(src.indexOf('label={w.addExpense}')).toBeGreaterThan(0);
    expect(src.indexOf('label={w.addExpense}')).toBeLessThan(src.indexOf('w.rentDueCap'));
    expect(src.indexOf('label={w.receiptsBtn}')).toBeGreaterThan(0);
    expect(src.indexOf('label={w.receiptsBtn}')).toBeLessThan(src.indexOf('w.rentDueCap'));
    expect(src).not.toContain('paddingBottom: clearance + theme.spacing.sm');
  });

  it('keeps the bottom clearance on the scroll content', () => {
    expect(src).toContain('paddingBottom: clearance + theme.spacing.lg');
  });
});

describe('rental property read-only copy (former couple)', () => {
  it('hides every write action when readOnly', () => {
    expect(src).toContain("const readOnly = isFormer(space ?? '')");
    expect(src).toMatch(/readOnly \? null : \(\s*<IconButton label=\{w\.addExpense\}/);
    expect(src).toMatch(/readOnly \? null : \(\s*<View[^>]*>\s*<Button\s+label=\{w\.recordRent\}/);
    expect(src).toMatch(/readOnly \? null : \(\s*<View[^>]*>\s*<Button\s+label=\{w\.addTenant\}/);
    expect(src).toContain('asked && !readOnly');
    expect(src).toContain('raise && !readOnly');
    expect(src).toContain("readOnly ? undefined : () => setOpen('deposit')");
    expect(src).toMatch(/readOnly \? null : \(\s*<IconButton label=\{t\.personalHome\.toolMore\}/);
    expect(src).toContain('readOnly={readOnly}');
  });

  it('shows the read-only note', () => {
    expect(src).toContain('{w.readOnlyCopy}');
  });
});
