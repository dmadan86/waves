import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// From the owner's screen recording: pushed from Home's "Categorize", the title and
// type chips truncated, the Uncategorized view could not categorize, and the empty
// state repeated the header subtitle.
const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');
const src = read('../src/app/personal/transactions.tsx');
const i18n = read('../src/i18n/index.ts');

describe('personal transactions screen', () => {
  it('shows the standard back button only when pushed, with the actions at the far end', () => {
    expect(src).toMatch(/hideBack=\{!drillIn\}/);
    expect(src).toMatch(/const actions/);
  });
  it('keeps the type chip labels whole: icon discs only where there is room, icon-only filter', () => {
    expect(src).toMatch(/tabsWidth \/ tabs\.length >= 96/);
    expect(src).not.toMatch(/\{t\.personal\.filterLabel\}\s*<\/Text>/);
  });
  it('opens the category picker from a row in the Uncategorized view', () => {
    expect(src).toMatch(/uncategorizedOnly[\s\S]{0,200}setCategorizing/);
    expect(src).toMatch(/useUpsertPersonalRecord/);
    expect(src).toMatch(/visible=\{categorizing !== null\}/);
  });
  it('empty state has its own line per locale and no plus icon on Clear filters', () => {
    expect(src).not.toMatch(/body=\{t\.personal\.transactionsSubtitle\}/);
    expect(src).toMatch(/t\.personal\.noEntriesForFilter/);
    expect(src).toMatch(/actionIcon=\{[^}]*null/);
    expect(i18n.match(/noEntriesForFilter:/g)?.length).toBe(5); // type + en, ta, hi, ar
  });
});
