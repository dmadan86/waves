import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  clearHeaderQuery,
  closeHeaderSearch,
  HEADER_SEARCH_CLOSED,
  openHeaderSearch,
  setHeaderQuery,
} from '../src/lib/headerSearch';
import { personalShowsAddFab } from '../src/lib/personalLayoutRules';

describe('header search state', () => {
  it('is closed and empty by default', () => {
    expect(HEADER_SEARCH_CLOSED).toEqual({ open: false, query: '' });
  });
  it('opens, types, clears the text but stays open', () => {
    const typed = setHeaderQuery(openHeaderSearch(HEADER_SEARCH_CLOSED), 'rent');
    expect(typed).toEqual({ open: true, query: 'rent' });
    expect(clearHeaderQuery(typed)).toEqual({ open: true, query: '' });
  });
  it('cancel closes and clears the query', () => {
    expect(closeHeaderSearch()).toEqual({ open: false, query: '' });
  });
});

describe('Transactions screen', () => {
  it('has no floating +', () => {
    expect(personalShowsAddFab(['personal', 'transactions'])).toBe(false);
  });
  it('puts search, mic and add in the header and no always-visible search field', () => {
    const src = readFileSync('src/app/personal/transactions.tsx', 'utf8');
    expect(src).toContain('t.personal.askByVoice');
    expect(src).toContain('t.personal.addTransaction');
    expect(src).toContain('mic-outline');
    expect(src).not.toContain('sparkles');
    expect(src).not.toContain('<TextInput');
  });
  it('renders the filter control outside search mode', () => {
    const src = readFileSync('src/app/personal/transactions.tsx', 'utf8');
    expect(src).toMatch(/\{filterChip\}/);
    expect(src).toContain('t.personal.filterLabel');
  });
});
