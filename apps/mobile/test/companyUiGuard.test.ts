/**
 * Company screens: a Button without `fullWidth` is `alignSelf: flex-start` (left-aligned),
 * so a stacked primary action must say `fullWidth` or sit in a row with `flex: 1`/space.
 * Files in SKIP keep deliberate left/centred buttons (empty states, header chips).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
  });
const files = [
  ...walk(join(SRC, 'components/company')),
  ...walk(join(SRC, 'app/group/[id]')).filter((p) => /company-/.test(p)),
].map((p) => [relative(SRC, p), readFileSync(p, 'utf8')] as const);

/** Stacked buttons that must be full-width; found by the audit and fixed. */
const MUST = [
  'company-vendor-order-detail.tsx',
  'company-vendor-receipt.tsx',
  'InquiryDetail.tsx',
  'InquiryParts.tsx',
  'CompanyEmploymentControl.tsx',
  'AddTaskSheet.tsx',
];

describe('company buttons', () => {
  for (const [path, text] of files.filter(([p]) => MUST.some((m) => p.endsWith(m)))) {
    it(`${path}: no bare left-aligned Button in a column`, () => {
      const bare = [...text.matchAll(/<Button\b([\s\S]*?)\/>/g)].filter(
        ([, b]) => !/fullWidth|style=|size="sm"|variant="ghost"/.test(b!),
      );
      // each remaining bare button must sit in a row (checked by a nearby flexDirection)
      for (const m of bare) {
        const before = text.slice(Math.max(0, m.index! - 300), m.index);
        expect(before, m[0].slice(0, 60)).toMatch(/flexDirection: 'row'|<Row|ios/);
      }
    });
  }
  it('company components use start/end, not left/right, for indents', () => {
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/(margin|padding)(Left|Right):\s*(level|\d)/);
    }
  });
});
