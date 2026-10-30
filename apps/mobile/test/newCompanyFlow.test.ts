import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (f: string): string => readFileSync(join(__dirname, '../src', f), 'utf8');

describe('create company flow', () => {
  it('every company create entry opens /new-company, never the group form', () => {
    for (const f of ['app/companies.tsx', 'components/SpaceSwitcher.tsx']) {
      const src = read(f);
      expect(src).toContain("router.push('/new-company')");
      expect(src).not.toContain('new-group');
    }
  });

  it('the old ?type=company link redirects to the new flow', () => {
    expect(read('app/new-group.tsx')).toContain("router.replace('/new-company')");
  });

  it('shows no group-only controls and keeps the gates', () => {
    const src = read('app/new-company.tsx');
    for (const word of ['GroupTagField', 'CoverEmojiPicker', 'TripDates', 'Toggle', 'newGroup']) {
      expect(src).not.toContain(word);
    }
    expect(src).toContain('guard.blockAddGroup()');
    expect(src).toContain('AdGateCancelledError');
    expect(src).toContain('GroupType.Company');
  });
});
