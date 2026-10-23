/**
 * Settings > Your data hub is compact and on the standard design.
 * Source-pinned, not mounted.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../src/app/settings/data.tsx'), 'utf8');

describe('Your data hub screen', () => {
  it('is built from the standard components', () => {
    for (const name of ['PlainHeader', 'StandardCard', 'SectionHeader', 'ListRow', 'RowTile']) {
      expect(src).toContain(`<${name}`);
    }
    expect(src).not.toContain('heroTitle');
    expect(src).not.toContain('ScenicHeader');
  });

  it('uses yourData i18n keys for title and section headers', () => {
    expect(src).toContain('t.yourData.title');
    expect(src).toContain('t.yourData.exportSection');
    expect(src).toContain('t.yourData.importSection');
    expect(src).toContain('t.yourData.exportHint');
    expect(src).toContain('t.yourData.importHint');
  });

  it('reuses exportData.title and account.importSplitwise for row labels', () => {
    expect(src).toContain('t.exportData.title');
    expect(src).toContain('t.account.importSplitwise');
  });

  it('links export row to /settings/export and import row to /settings/import', () => {
    expect(src).toContain("router.push('/settings/export')");
    expect(src).toContain("router.push('/settings/import')");
  });

  it('has no standalone action button (rows are the only actions)', () => {
    expect(src).not.toContain('backgroundColor: theme.color.brand,');
  });
});
