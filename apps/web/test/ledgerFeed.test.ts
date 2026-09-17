/**
 * The order a group's ledger reads in.
 *
 * `waves.expenses` orders rows by `created_at` — when somebody typed the bill
 * in. The feed has to read in the order the bills were *paid*, or a July
 * receipt entered this afternoon opens the page above September, taking its
 * whole month heading with it. That is the case these tests exist for; the
 * grouping around it is simple enough that it would not be worth a file.
 */

import { describe, expect, it } from 'vitest';
import type { Expense } from '@waves/api-client';

import { groupByMonth, monthLabel } from '../src/lib/ledgerFeed';

/** Only the two fields the feed reads; the rest of an Expense is not involved. */
function bill(id: string, expenseDate: string | null): Expense {
  return {
    id,
    currentVersion: expenseDate === null ? null : { expense_date: expenseDate },
  } as unknown as Expense;
}

const keysOf = (rows: Expense[]) => groupByMonth(rows).map((section) => section.key);
const idsOf = (rows: Expense[]) =>
  groupByMonth(rows).flatMap((section) => section.rows.map((row) => row.id));

describe('groupByMonth', () => {
  it('reads newest month first whatever order the rows arrived in', () => {
    // As the server returns them: newest *entered* first, and the July bill was
    // entered last week — after the September ones.
    const rows = [bill('sep', '2026-09-03'), bill('aug', '2026-08-30'), bill('jul', '2026-07-11')];
    expect(keysOf(rows)).toEqual(['2026-09', '2026-08', '2026-07']);
  });

  it('puts a backdated bill in its own month, not at the top', () => {
    // The regression: `jul` was created most recently, so an insertion-ordered
    // feed opened on July.
    const rows = [bill('jul', '2026-07-11'), bill('sep', '2026-09-03'), bill('aug', '2026-08-30')];
    expect(keysOf(rows)).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(idsOf(rows)).toEqual(['sep', 'aug', 'jul']);
  });

  it('orders the rows inside a month too', () => {
    const rows = [bill('early', '2026-09-02'), bill('late', '2026-09-28')];
    expect(idsOf(rows)).toEqual(['late', 'early']);
  });

  it('keeps undated rows in one bucket at the end', () => {
    const rows = [bill('nodate', null), bill('sep', '2026-09-03')];
    expect(keysOf(rows)).toEqual(['2026-09', '~']);
    // The heading is dropped for that bucket rather than invented.
    expect(groupByMonth(rows).at(-1)?.date).toBeNull();
  });

  it('drops nothing', () => {
    const rows = [bill('a', '2026-09-03'), bill('b', null), bill('c', '2026-09-04')];
    expect(idsOf(rows)).toHaveLength(3);
  });

  it('has no months for no rows', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe('monthLabel', () => {
  const formats = {
    sameYear: new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }),
    withYear: new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  };

  it('names a month in the current year without repeating the year', () => {
    const thisYear = new Date().getUTCFullYear();
    expect(monthLabel(formats, `${thisYear}-03-14`)).toBe('March');
  });

  it('adds the year once it is not this one', () => {
    expect(monthLabel(formats, '2019-03-14')).toBe('March 2019');
  });

  it('reads the date in UTC, so a heading cannot slip a month', () => {
    // The first of a month in a timezone behind UTC would otherwise render as
    // the previous month for readers west of it.
    expect(monthLabel(formats, '2019-03-01')).toBe('March 2019');
  });

  it('falls back to the raw value rather than printing "Invalid Date"', () => {
    expect(monthLabel(formats, 'not-a-date')).toBe('not-a-date');
  });
});
