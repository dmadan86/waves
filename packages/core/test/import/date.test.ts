import { describe, expect, it } from 'vitest';

import { defaultDateOrder, excelSerialToIso, resolveDates } from '../../src/import/date.js';

const isos = (values: string[], options = {}) =>
  resolveDates(values, { today: '2026-10-12', ...options }).cells.map((cell) => cell.iso);

describe('resolveDates', () => {
  it('reads unambiguous formats', () => {
    expect(
      isos([
        '2026-10-01',
        '2026/10/02',
        '2026-10-03 14:30:00',
        '2026-10-04T08:00:00Z',
        '1 Oct 2026',
        'Oct 5, 2026',
        '06-Oct-26',
        '7 October 2026',
        'Sept 8 2026',
      ]),
    ).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-01',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-09-08',
    ]);
  });

  it('settles day-first from any value whose first part is above 12', () => {
    const resolved = resolveDates(['03/04/2026', '25/04/2026'], { today: '2026-10-12' });
    expect(resolved.order).toBe('dmy');
    expect(resolved.basis).toBe('forced');
    expect(resolved.ambiguous).toBe(false);
    expect(resolved.cells.map((cell) => cell.iso)).toEqual(['2026-04-03', '2026-04-25']);
  });

  it('settles month-first from any value whose second part is above 12', () => {
    const resolved = resolveDates(['03/04/2026', '04/25/2026'], {
      today: '2026-10-12',
      country: 'IN',
    });
    expect(resolved.order).toBe('mdy');
    expect(resolved.cells.map((cell) => cell.iso)).toEqual(['2026-03-04', '2026-04-25']);
  });

  it('falls back to the group’s country and says it guessed', () => {
    const india = resolveDates(['03/04/2026'], { country: 'IN' });
    expect(india).toMatchObject({ order: 'dmy', basis: 'country', ambiguous: true });
    expect(india.cells[0]?.iso).toBe('2026-04-03');

    const us = resolveDates(['03/04/2026'], { country: 'US' });
    expect(us).toMatchObject({ order: 'mdy', basis: 'country', ambiguous: true });
    expect(us.cells[0]?.iso).toBe('2026-03-04');
  });

  it('breaks the tie by whichever reading keeps the rows in date order', () => {
    // As day-first these run 5 Jan, 3 Feb, 7 Mar; as month-first 1 May, 2 Mar, 3 Jul: not in order.
    const dayFirst = resolveDates(['05/01/2026', '03/02/2026', '07/03/2026'], { country: 'US' });
    expect(dayFirst).toMatchObject({ order: 'dmy', basis: 'monotonic', ambiguous: false });

    const monthFirst = resolveDates(['01/05/2026', '02/03/2026', '03/07/2026'], { country: 'IN' });
    expect(monthFirst).toMatchObject({ order: 'mdy', basis: 'monotonic' });
  });

  it('also accepts a newest-first export', () => {
    const resolved = resolveDates(['07/03/2026', '03/02/2026', '05/01/2026'], { country: 'US' });
    expect(resolved).toMatchObject({ order: 'dmy', basis: 'monotonic' });
  });

  it('reports mixed formats per row instead of picking one', () => {
    const resolved = resolveDates(['25/04/2026', '04/25/2026', '03/04/2026'], {
      today: '2026-10-12',
    });
    expect(resolved.mixed).toBe(true);
    expect(resolved.order).toBeNull();
    expect(resolved.cells.map((cell) => cell.failure)).toEqual([null, null, 'mixed']);
    expect(resolved.cells.slice(0, 2).map((cell) => cell.iso)).toEqual([
      '2026-04-25',
      '2026-04-25',
    ]);
  });

  it('lets the person’s choice override, and refuses what that choice cannot read', () => {
    const resolved = resolveDates(['03/04/2026', '25/04/2026'], { order: 'mdy' });
    expect(resolved.basis).toBe('chosen');
    expect(resolved.cells[0]?.iso).toBe('2026-03-04');
    expect(resolved.cells[1]).toEqual({ iso: null, failure: 'impossible' });
  });

  it('rejects impossible and unreadable dates', () => {
    const cells = resolveDates(['31/02/2026', '2026-13-01', 'yesterday', ''], {
      today: '2026-10-12',
    }).cells;
    expect(cells.map((cell) => cell.failure)).toEqual([
      'impossible',
      'impossible',
      'unreadable',
      'unreadable',
    ]);
  });

  it('expands two-digit years to 20xx unless that is more than a year ahead', () => {
    expect(isos(['25/12/26', '25/12/99'])).toEqual(['2026-12-25', '1999-12-25']);
  });

  it('reads dotted and dashed day-first dates', () => {
    expect(isos(['15.03.2026', '16-03-2026'])).toEqual(['2026-03-15', '2026-03-16']);
  });

  it('reads Excel serials only when told the column is dates', () => {
    expect(isos(['46000'], { allowSerial: true })).toEqual([excelSerialToIso(46000)]);
    expect(isos(['46000'])).toEqual([null]);
    expect(excelSerialToIso(45292)).toBe('2024-01-01');
    expect(excelSerialToIso(12)).toBeNull();
  });
});

describe('defaultDateOrder', () => {
  it('is month-first for the US, Philippines and Canada only', () => {
    expect(['US', 'PH', 'CA'].map(defaultDateOrder)).toEqual(['mdy', 'mdy', 'mdy']);
    expect(['IN', 'GB', 'AE', 'AU', null].map(defaultDateOrder)).toEqual([
      'dmy',
      'dmy',
      'dmy',
      'dmy',
      'dmy',
    ]);
  });
});
