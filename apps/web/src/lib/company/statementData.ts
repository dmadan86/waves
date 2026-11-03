import {
  formatCompanyStatement,
  minorUnitExponent,
  type CurrencyCode,
  type CompanyEntry,
  type CompanyStatement,
} from '@waves/core';

import { fillText, wagesStrings as s } from './wagesStrings';

export type StatementPeriod = 'month' | 'last' | 'all';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Inclusive yyyy-mm-dd bounds for a period (same rule as the phone). */
export function periodRange(period: StatementPeriod, today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (period === 'all') return { from: '0000-01-01', to: '9999-12-31' };
  const target =
    period === 'month'
      ? { y: year, m: month }
      : month === 1
        ? { y: year - 1, m: 12 }
        : { y: year, m: month - 1 };
  const last = new Date(Date.UTC(target.y, target.m, 0)).getUTCDate();
  return { from: `${target.y}-${pad(target.m)}-01`, to: `${target.y}-${pad(target.m)}-${pad(last)}` };
}

/** shortcut: web has no custom-tag hook yet, so a tag key reads as its words; upgrade when tags are ported. */
export function kindLabel(entry: CompanyEntry): string {
  switch (entry.kind) {
    case 'expense':
      return entry.category ? entry.category.replace(/[_-]+/g, ' ') : s.kOther;
    case 'allowance':
      return s.kBata;
    case 'advance':
      return s.kAdvance;
    case 'wages':
    case 'wage_payment':
      return s.kWages;
    case 'allocation':
      return s.kAllocation;
    case 'pool_return':
      return s.kPoolReturn;
    case 'pool_adjustment':
      return s.kPoolAdjustment;
    case 'pool_request':
      return s.kAsk;
    case 'reimbursement':
      return entry.direction === 'employee_to_company' ? s.kCashReturned : s.kReimbursement;
  }
}

export function statementText(
  statement: CompanyStatement,
  company: string,
  employee: string,
  fmt: (minor: bigint) => string,
): string {
  return formatCompanyStatement(statement, { company, employee, money: fmt });
}

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Date, type, note, amount, running balance: plain numbers so a spreadsheet can add them. */
export function statementCsv(statement: CompanyStatement, currency: string): string {
  const minorUnit = (m: bigint): string => {
    const exp = minorUnitExponent(currency as CurrencyCode);
    const neg = m < 0n;
    const digits = (neg ? -m : m).toString().padStart(exp + 1, '0');
    const out = exp ? `${digits.slice(0, -exp)}.${digits.slice(-exp)}` : digits;
    return neg ? `-${out}` : out;
  };
  const rows = statement.rows.map(({ entry, delta, running }) =>
    [entry.occurredOn, kindLabel(entry), entry.note ?? '', minorUnit(delta), minorUnit(running)]
      .map(csvCell)
      .join(','),
  );
  return ['Date,Type,Note,Amount,Balance', ...rows].join('\n');
}

export function saveText(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export { fillText };
