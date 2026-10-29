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
  colPaidBy: 'Paid by',
  companyPayer: 'Company',
  colStatus: 'Status',
  colAmount: 'Amount',
  colBalance: 'Balance',
  colNote: 'Note',
  colReview: 'Review',
  colVendor: 'Vendor',
  colGstin: 'GSTIN',
  colInvoice: 'Invoice',
  colGst: 'GST',
  detail: () => '',
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
  it('includes company payers with a blank employee, expense and GST totals, and no employee balance', () => {
    const paid = entry({
      member_id: null,
      paid_by_company: true,
      category: 'materials',
      amount: '11800',
      gst_amount_minor: '1800',
    });
    const personal = entry({ amount: '10000' });
    const model = buildCompanyExport({
      ...base,
      scope: 'admin',
      names: new Map([['ravi', 'Ravi']]),
      entries: [paid, personal],
      labels: {
        ...labels,
        totalRows: (t) => [
          ['Expenses', t.expenses],
          ['GST', t.gst],
        ],
      },
    });
    const rows = model.sections.find((s) => s.heading === 'Entries')!;
    expect(rows.columns).toContain('Paid by');
    const company = rows.rows.find((r) => r[2]?.text === 'Company')!;
    expect(company[1]?.text).toBe('');
    expect(rows.rows.find((r) => r[2]?.text === 'Ravi')?.[1]?.text).toBe('Ravi');
    expect(model.sections[0]?.rows.map((r) => r[1]?.value)).toEqual([218, 18]);
    expect(model.sections.find((s) => s.heading === 'Employees')?.rows).toHaveLength(1);
    expect(renderCompanyExportHtml(model, 'None')).toContain('Company');
    expect(JSON.stringify(buildCompanyExportWorkbook(model).Sheets)).toContain('Paid by');
    const own = buildCompanyExport({
      ...base,
      scope: 'employee',
      memberId: 'ravi',
      employeeName: 'Ravi',
      entries: [paid],
    });
    expect(own.sections.find((s) => s.heading === 'Entries')?.rows).toEqual([]);
  });

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

  it('prints vendor, GSTIN, invoice and GST only when an entry has them, and totals GST', () => {
    const gst = entry({
      amount: '11800',
      vendor: 'Bata Store',
      gstin: '27AAPFU0939F1ZV',
      invoice_no: 'INV-9',
      gst_amount_minor: '1800',
    });
    const withGst = buildCompanyExport({
      ...base,
      labels: { ...labels, totalRows: (t) => [['GST', t.gst]] },
      scope: 'admin',
      names: new Map([['ravi', 'Ravi']]),
      entries: [gst],
    });
    const dump = JSON.stringify(withGst);
    expect(dump).toContain('27AAPFU0939F1ZV');
    expect(dump).toContain('INV-9');
    expect(withGst.sections[0]?.rows[0]?.[1]?.text).toContain('18');
    const without = buildCompanyExport({
      ...base,
      scope: 'admin',
      names: new Map([['ravi', 'Ravi']]),
      entries: [mine],
    });
    expect(JSON.stringify(without)).not.toContain('GSTIN');
  });
});
