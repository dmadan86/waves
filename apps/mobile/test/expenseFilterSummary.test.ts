import { describe, expect, it } from 'vitest';

import { filterPillText } from '../src/lib/expenseFilterSummary';
import { openPayerRows } from '../src/lib/expensesByPayer';

describe('filterPillText', () => {
  it('says Filter by default', () => {
    expect(filterPillText([null, null, false], 'Filter')).toEqual({
      text: 'Filter',
      active: false,
    });
  });
  it('joins active parts, two at most, then +n', () => {
    expect(filterPillText(['Mine', null], 'Filter')).toEqual({ text: 'Mine', active: true });
    expect(filterPillText([null, 'Nov', 'By person'], 'Filter').text).toBe('Nov · By person');
    expect(filterPillText(['Mine', 'Oct', 'By person'], 'Filter').text).toBe('Mine · Oct +1');
  });
});

describe('openPayerRows', () => {
  const sections = [
    { memberId: 'a', total: 3n, rows: [1, 2] },
    { memberId: null, total: 1n, rows: [3] },
  ] as never;
  it('hides rows of collapsed payers', () => {
    expect(openPayerRows<number>(sections, new Set()).map((s) => s.rows.length)).toEqual([0, 0]);
  });
  it('shows rows of expanded payers, several at once', () => {
    expect(openPayerRows<number>(sections, new Set(['a', '~'])).map((s) => s.rows.length)).toEqual([
      2, 1,
    ]);
  });
});
