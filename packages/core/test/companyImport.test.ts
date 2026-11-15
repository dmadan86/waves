import { describe, expect, it } from 'vitest';

import {
  buildImportRows,
  countRows,
  headerKey,
  matchColumns,
  parseImportDate,
  readTable,
  sheetCsvUrl,
  templateCsv,
  toCsv,
  type ImportContext,
} from '../src';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  entity: 'employee',
  groupId: 'g1',
  currency: 'INR',
  dialCode: '+91',
  existing: [],
  ...over,
});

describe('matchColumns', () => {
  it('matches English, Hindi and Tamil headers', () => {
    expect(
      matchColumns(
        ['Emp ID', 'Employee Name', 'Mobile', 'Dept', 'Joining Date', 'Daily Rate'],
        'employee',
      ),
    ).toEqual({ employeeId: 0, name: 1, phone: 2, department: 3, joinedOn: 4, dailyRate: 5 });
    expect(matchColumns(['नाम', 'फ़ोन'], 'client')).toEqual({ name: 0, phone: 1 });
    expect(matchColumns(['பெயர்', 'மொபைல்', 'வகை'], 'vendor')).toEqual({
      name: 0,
      phone: 1,
      category: 2,
    });
  });
  it('maps party-style headers and keeps a Manager Name column off the name', () => {
    expect(matchColumns(['Party Name', 'Phone No.', 'Opening Balance'], 'vendor')).toEqual({
      name: 0,
      phone: 1,
      openingBalance: 2,
    });
    expect(matchColumns(['Manager Name', 'Staff Name'], 'employee')).toEqual({
      manager: 0,
      name: 1,
    });
  });
  it('folds the composed and decomposed nukta', () => {
    expect(headerKey('फ़ोन')).toBe(headerKey('फ़ोन'));
  });
});

describe('parseImportDate', () => {
  it('reads dd/mm/yyyy and yyyy-mm-dd, refuses impossible days', () => {
    expect(parseImportDate('15/01/2026')).toBe('2026-01-15');
    expect(parseImportDate('5-3-26')).toBe('2026-03-05');
    expect(parseImportDate('2026-01-15')).toBe('2026-01-15');
    expect(parseImportDate('31/02/2026')).toBeNull();
    expect(parseImportDate('soon')).toBeNull();
  });
});

describe('buildImportRows', () => {
  const map = { name: 0, phone: 1, joinedOn: 2, dailyRate: 3 };
  const build = (rows: string[][], over: Partial<ImportContext> = {}) =>
    buildImportRows(
      rows,
      rows.map((_, i) => i + 2),
      map,
      ctx(over),
    );

  it('normalises phone to +91, amounts to minor units, dates to ISO', () => {
    const [row] = build([['Ravi', '98765 43210', '15/01/2026', '₹1,200.50']]);
    expect(row?.status).toBe('new');
    expect(row?.values).toMatchObject({
      phone: '+919876543210',
      joinedOn: '2026-01-15',
      dailyRateMinor: 120050n,
    });
  });
  it('reports why a row failed', () => {
    const rows = build([
      ['', '9876543210', '', ''],
      ['A', '12', '', ''],
      ['B', '', '99/99/2026', ''],
      ['C', '', '', 'lots'],
      ['D', '', '', '-5'],
    ]);
    expect(rows.map((r) => r.problem)).toEqual([
      'name_missing',
      'phone_invalid',
      'date_invalid',
      'amount_invalid',
      'amount_negative',
    ]);
  });
  it('skips duplicates by phone, then by name, case-insensitively, and within the file', () => {
    const rows = build(
      [
        ['Someone Else', '9876543210', '', ''],
        ['RAMESH', '', '', ''],
        ['New One', '9000000001', '', ''],
        ['New One Again', '+91 90000 00001', '', ''],
        ['Ramesh', '9111111111', '', ''],
      ],
      {
        existing: [
          { name: 'Ravi', phone: '+919876543210' },
          { name: 'Ramesh', phone: '+919222222222' },
        ],
      },
    );
    expect(rows.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'new',
      'duplicate',
      'new',
    ]);
    expect(countRows(rows)).toEqual({ added: 2, duplicates: 3, errors: 0 });
  });
  it('treats the same name with and without a phone in one file as one row', () => {
    const rows = build([
      ['Acme', '9000000002', '', ''],
      ['acme', '', '', ''],
      ['Beta', '', '', ''],
      ['Beta', '9000000003', '', ''],
    ]);
    expect(rows.map((r) => r.status)).toEqual(['new', 'duplicate', 'new', 'duplicate']);
  });
  it('gives the same id on every run', () => {
    const a = build([['Ravi', '9876543210', '', '']])[0];
    const b = build([['ravi', '+91 9876543210', '', '']])[0];
    expect(a?.id).toBe(b?.id);
    expect(build([['X', '', '', '']])[0]?.id).not.toBe(a?.id);
  });
  it('resolves department and manager by name and warns when unknown', () => {
    const rows = buildImportRows(
      [
        ['Ravi', 'sales', 'Boss'],
        ['Sita', 'Ops', 'Nobody'],
      ],
      [2, 3],
      { name: 0, department: 1, manager: 2 },
      ctx({
        departments: [{ id: 'd1', name: 'Sales' }],
        people: [{ id: 'm1', name: 'boss' }],
      }),
    );
    expect(rows[0]?.values).toMatchObject({ departmentId: 'd1', managerId: 'm1' });
    expect(rows[1]?.warnings).toEqual(['department_unknown', 'manager_unknown']);
  });
  it('drops an employee id that is already taken', () => {
    const rows = buildImportRows(
      [
        ['A', 'emp-1'],
        ['B', 'EMP-1'],
      ],
      [2, 3],
      { name: 0, employeeId: 1 },
      ctx(),
    );
    expect(rows[0]?.values?.employeeId).toBe('emp-1');
    expect(rows[1]?.values?.employeeId).toBeNull();
    expect(rows[1]?.warnings).toEqual(['employee_id_taken']);
  });
  it('reads clients: stage defaults to client, a status word overrides', () => {
    const rows = buildImportRows(
      [
        ['A', 'Enquiry'],
        ['B', ''],
      ],
      [2, 3],
      { name: 0, stage: 1 },
      ctx({ entity: 'client' }),
    );
    expect(rows.map((r) => r.values?.stage)).toEqual(['inquiry', 'client']);
  });
});

describe('templates and csv', () => {
  it('a template reads back through the matcher with no unmatched column', () => {
    for (const e of ['employee', 'client', 'vendor'] as const) {
      const table = readTable(templateCsv(e));
      const mapping = matchColumns(table.rows[0] ?? [], e);
      expect(Object.keys(mapping)).toHaveLength(table.rows[0]?.length ?? -1);
    }
  });
  it('guards formulas and quotes in written CSV', () => {
    expect(toCsv([['=1+1', 'a,b', 'say "hi"']])).toBe(`'=1+1,"a,b","say ""hi"""`);
  });
});

describe('sheetCsvUrl', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  it('rebuilds the export address from id and gid', () => {
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123`)).toBe(
      `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=123`,
    );
    expect(sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`)).toContain(
      'gid=0',
    );
  });
  it('refuses other hosts, schemes and lookalikes', () => {
    for (const bad of [
      `http://docs.google.com/spreadsheets/d/${id}/edit`,
      `https://docs.google.com.evil.com/spreadsheets/d/${id}/edit`,
      `https://evil.com/spreadsheets/d/${id}/edit`,
      `https://user@docs.google.com/spreadsheets/d/${id}/edit`,
      `https://docs.google.com@evil.com/spreadsheets/d/${id}`,
      `https://docs.google.com:8443/spreadsheets/d/${id}`,
      'https://docs.google.com/document/d/abc/edit',
      'not a url',
    ]) {
      expect(sheetCsvUrl(bad)).toBeNull();
    }
  });
});
