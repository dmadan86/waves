/**
 * Settings > Export your data is compact and on the standard design, and every
 * option it ever had is still reachable. Source-pinned, not mounted.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../src/app/settings/export.tsx'), 'utf8');

describe('export screen', () => {
  it('is built from the standard components, with no hero or hand-drawn art', () => {
    for (const name of ['PlainHeader', 'StandardCard', 'SectionHeader', 'ListRow', 'RowTile']) {
      expect(src).toContain(`<${name}`);
    }
    expect(src).not.toContain('FolderArt');
    expect(src).not.toContain('heroTitle');
    expect(src).not.toContain('heroBody');
    expect(src).not.toContain('ScopeTile');
    expect((src.match(/<StandardCard/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('keeps every format, scope, sheet, status and the import door', () => {
    for (const f of ['Json', 'Csv', 'Pdf']) expect(src).toContain(`Format.${f}`);
    for (const k of [
      'allMyGroups',
      'oneGroup',
      'pickGroup',
      'includedTitle',
      'includedBody',
      'exportAction',
      'preparing',
      'ready',
      'webNote',
      'freeBadge',
      'shareTitle',
      'exportFailed',
    ]) {
      expect(src).toContain(k);
    }
    expect(src).toContain('exportData({');
    expect(src).toContain('groupId: scope');
    expect(src).toContain('Sharing.shareAsync');
    expect(src).not.toContain("router.push('/settings/import')");
    expect(src).toContain('<Callout tone="negative">');
    expect(src).toContain('showIncluded');
    expect(src).toContain('pickingGroup');
  });

  it('has a single brand primary button', () => {
    expect((src.match(/backgroundColor: theme\.color\.brand,/g) ?? []).length).toBe(1);
  });
});
