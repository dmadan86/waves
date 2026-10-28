import { describe, expect, it } from 'vitest';

import { companyEntryFromRow, type CompanyEntry } from '@waves/core';

import {
  buildCompanyExport,
  buildCompanyExportWorkbook,
  renderCompanyExportHtml,
  safeCellText,
  type CompanyExportLabels,
} from '../src/data/companyExport';

let n = 0;
const entry = (over: Record<string, unknown>): CompanyEntry => {
  n += 1;
  return companyEntryFromRow({
    id: `e${n}`,
    group_id: 'g',
    member_id: 'ravi',
    entry_kind: 'expense',
    amount: '10000',
    currency: 'INR',
    occurred_on: '2026-10-05',
    status: 'approved',
    ...over,
  } as never);
};

const labels: CompanyExportLabels = {
  statement: 'Statement',
  summary: 'Summary',
  generatedOn: 'On',
  balance: 'Balance',
  companyOwesAll: 'Company owes',
  employeesOweAll: (a) => `Employees owe ${a}`,
  companyOwesYou: 'Company owes you',
  youOweCompany: 'You owe',
  settled: 'Settled',
  totals: 'Totals',
  byCategory: 'By category',
  employees: 'Employees',
  entries: 'Entries',
  pending: 'Pending',
  brought: 'Brought',
  colDate: 'Date',
  colType: 'Type',
  colMember: 'Member',
  colStatus: 'Status',
  colAmount: 'Amount',
  colBalance: 'Balance',
  colNote: 'Note',
  colReview: 'Review',
  none: 'None',
  footer: 'Waves',
  kind: (e) => e.kind,
  category: (k) => k,
  status: (e) => e.status,
  totalRows: (t) => [['Expenses', t.expenses]],
};

const base = {
  company: 'Acme',
  currency: 'INR',
  locale: 'en-IN',
  from: '2026-10-01',
  to: '2026-10-31',
  generatedOn: '2026-10-28',
  periodLabel: 'This month',
  labels,
};

describe('company export', () => {
  const mine = entry({ amount: '50000', note: '=HYPERLINK("x")' });
  const other = entry({ member_id: 'sita', amount: '99999', note: 'SECRETNOTE' });

  it('an employee export carries only their own entries, even if given more', () => {
    const model = buildCompanyExport({
      ...base,
      scope: 'employee',
      memberId: 'ravi',
      employeeName: 'Ravi',
      entries: [mine, other],
    });
    const dump = JSON.stringify(model);
    expect(dump).not.toContain('SECRETNOTE');
    expect(dump).not.toContain('999.99');
  });

  it('only approved entries reach the balance; submitted ones are listed apart with their note', () => {
    const model = buildCompanyExport({
      ...base,
      scope: 'employee',
      memberId: 'ravi',
      employeeName: 'Ravi',
      entries: [mine, entry({ status: 'rejected', amount: '7000', review_note: 'no bill' })],
    });
    expect(model.headline[0]?.[1]).toContain('500');
    const pending = model.sections.find((s) => s.heading === 'Pending');
    expect(pending?.rows[0]?.[4]?.text).toBe('no bill');
  });

  it('the admin summary names every employee, and the workbook neutralises formulas', () => {
    const model = buildCompanyExport({
      ...base,
      scope: 'admin',
      names: new Map([
        ['ravi', 'Ravi'],
        ['sita', 'Sita'],
      ]),
      entries: [mine, other],
    });
    const html = renderCompanyExportHtml(model, 'None');
    expect(html).toContain('Sita');
    expect(html).not.toContain('<script');
    const book = buildCompanyExportWorkbook(model);
    const cells = JSON.stringify(book.Sheets);
    expect(cells).not.toContain('"v":"=HYPERLINK');
    expect(safeCellText('=1+1')).toBe("'=1+1");
    expect(safeCellText('plain')).toBe('plain');
  });

  it('escapes markup in notes', () => {
    const model = buildCompanyExport({
      ...base,
      scope: 'employee',
      memberId: 'ravi',
      employeeName: 'Ravi',
      entries: [entry({ note: '<img src=x onerror=1>' })],
    });
    expect(renderCompanyExportHtml(model, 'None')).not.toContain('<img');
  });
});
