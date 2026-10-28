/**
 * Company statements as a document: an employee's statement, or the admin's
 * summary, rendered to a PDF page (HTML) or an Excel workbook from one model.
 *
 * Pure. The model is built from `@waves/core`'s statement and summary maths over
 * the entries the viewer can read, and an employee's export is filtered to their
 * own member id a second time here, so it cannot carry anyone else's rows even if
 * a caller passed too many. No photo, path or URL is ever in the model.
 */

import * as XLSX from 'xlsx';

import {
  companyStatement,
  companySummary,
  format,
  toMajorString,
  type CompanyEntry,
  type CompanyStatementTotals,
  type CurrencyCode,
} from '@waves/core';

import { escapeHtml } from './groupExportHtml';
import { isRtlLocale } from './groupExport';

/** A table cell: the text to print, and the number a spreadsheet should sum. */
export interface CompanyCell {
  readonly text: string;
  readonly value?: number;
}

export interface CompanyExportSection {
  readonly heading: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly CompanyCell[])[];
}

export interface CompanyExportModel {
  readonly title: string;
  readonly subtitle: string;
  readonly generatedOn: string;
  readonly headline: readonly (readonly [string, string])[];
  readonly sections: readonly CompanyExportSection[];
  readonly isRtl: boolean;
  readonly footer: string;
}

export interface CompanyExportLabels {
  readonly statement: string;
  readonly summary: string;
  readonly generatedOn: string;
  readonly balance: string;
  readonly companyOwesAll: string;
  readonly employeesOweAll: (amount: string) => string;
  readonly companyOwesYou: string;
  readonly youOweCompany: string;
  readonly settled: string;
  readonly totals: string;
  readonly byCategory: string;
  readonly employees: string;
  readonly entries: string;
  readonly pending: string;
  readonly brought: string;
  readonly colDate: string;
  readonly colType: string;
  readonly colMember: string;
  readonly colStatus: string;
  readonly colAmount: string;
  readonly colBalance: string;
  readonly colNote: string;
  readonly colReview: string;
  readonly none: string;
  readonly footer: string;
  /** Entry kind (and expense category) as printed. */
  readonly kind: (entry: CompanyEntry) => string;
  readonly category: (key: string) => string;
  readonly status: (entry: CompanyEntry) => string;
  /** Totals rows in print order. */
  readonly totalRows: (totals: CompanyStatementTotals) => readonly (readonly [string, bigint])[];
  /** Sentence for a closing balance (employee statement). */
}

export type CompanyExportInput =
  | {
      readonly scope: 'employee';
      readonly memberId: string;
      readonly employeeName: string;
    }
  | { readonly scope: 'admin'; readonly names: ReadonlyMap<string, string> };

export function buildCompanyExport(
  input: CompanyExportInput & {
    readonly entries: readonly CompanyEntry[];
    readonly company: string;
    readonly currency: string;
    readonly locale: string;
    readonly from: string;
    readonly to: string;
    readonly generatedOn: string;
    /** The period as the person picked it ("This month"), printed under the title. */
    readonly periodLabel: string;
    readonly labels: CompanyExportLabels;
  },
): CompanyExportModel {
  const { labels, currency, locale } = input;
  const code = currency as CurrencyCode;
  const cell = (minor: bigint): CompanyCell => ({
    text: format({ minor, currency: code }, { locale }),
    value: Number(toMajorString({ minor, currency: code })),
  });
  const text = (value: string | null | undefined): CompanyCell => ({ text: value ?? '' });
  const abs = (minor: bigint): bigint => (minor < 0n ? -minor : minor);

  if (input.scope === 'employee') {
    // Own rows only, whatever the caller passed.
    const own = input.entries.filter((entry) => entry.memberId === input.memberId);
    const statement = companyStatement(own, {
      memberId: input.memberId,
      from: input.from,
      to: input.to,
    });
    const side =
      statement.side === 'settled'
        ? labels.settled
        : statement.side === 'company_owes'
          ? labels.companyOwesYou
          : labels.youOweCompany;
    return {
      title: `${labels.statement} · ${input.employeeName}`,
      subtitle: `${input.company} · ${input.periodLabel}`,
      generatedOn: input.generatedOn,
      headline: [
        [
          labels.balance,
          `${format({ minor: abs(statement.closing), currency: code }, { locale })} · ${side}`,
        ],
      ],
      isRtl: isRtlLocale(locale),
      footer: labels.footer,
      sections: [
        {
          heading: labels.totals,
          columns: ['', labels.colAmount],
          rows: [
            ...(statement.opening !== 0n ? [[text(labels.brought), cell(statement.opening)]] : []),
            ...labels
              .totalRows(statement.totals)
              .filter(([, value]) => value !== 0n)
              .map(([label, value]) => [text(label), cell(value)]),
          ],
        },
        {
          heading: labels.entries,
          columns: [
            labels.colDate,
            labels.colType,
            labels.colNote,
            labels.colAmount,
            labels.colBalance,
          ],
          rows: statement.rows.map(({ entry, delta, running }) => [
            text(entry.occurredOn),
            text(labels.kind(entry)),
            text(entry.note),
            cell(entry.kind === 'wages' ? entry.amount : delta),
            cell(running),
          ]),
        },
        {
          heading: labels.pending,
          columns: [
            labels.colDate,
            labels.colType,
            labels.colStatus,
            labels.colAmount,
            labels.colReview,
          ],
          rows: statement.pending.map((entry) => [
            text(entry.occurredOn),
            text(labels.kind(entry)),
            text(labels.status(entry)),
            cell(entry.amount),
            text(entry.reviewNote),
          ]),
        },
      ],
    };
  }

  const summary = companySummary(input.entries, { from: input.from, to: input.to });
  const name = (id: string): string => input.names.get(id) ?? '';
  const live = input.entries
    .filter(
      (entry) => !entry.deleted && entry.occurredOn >= input.from && entry.occurredOn <= input.to,
    )
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
  return {
    title: `${labels.summary} · ${input.company}`,
    subtitle: input.periodLabel,
    generatedOn: input.generatedOn,
    headline: [
      [labels.companyOwesAll, format({ minor: summary.companyOwes, currency: code }, { locale })],
      [
        labels.employeesOweAll(format({ minor: summary.employeesOwe, currency: code }, { locale })),
        '',
      ],
    ],
    isRtl: isRtlLocale(locale),
    footer: labels.footer,
    sections: [
      {
        heading: labels.totals,
        columns: ['', labels.colAmount],
        rows: labels
          .totalRows(summary.totals)
          .filter(([, value]) => value !== 0n)
          .map(([label, value]) => [text(label), cell(value)]),
      },
      {
        heading: labels.byCategory,
        columns: ['', labels.colAmount],
        rows: Object.entries(summary.totals.byCategory).map(([key, value]) => [
          text(labels.category(key)),
          cell(value),
        ]),
      },
      {
        heading: labels.employees,
        columns: [labels.colMember, labels.colBalance],
        rows: summary.rows.map((row) => [text(name(row.memberId)), cell(row.statement.closing)]),
      },
      {
        heading: labels.entries,
        columns: [
          labels.colDate,
          labels.colMember,
          labels.colType,
          labels.colStatus,
          labels.colAmount,
          labels.colReview,
        ],
        rows: live.map((entry) => [
          text(entry.occurredOn),
          text(name(entry.memberId)),
          text(labels.kind(entry)),
          text(labels.status(entry)),
          cell(entry.amount),
          text(entry.reviewNote),
        ]),
      },
    ],
  };
}

const STYLE = `body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1c1b29;margin:28px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:22px 0 6px;color:#4a43c9}
.sub{color:#6b6a7a;font-size:12px;margin-top:4px}.head{margin:14px 0}.head b{font-size:18px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:5px 6px;border-bottom:1px solid #e6e5ee;vertical-align:top}
th{color:#6b6a7a;font-weight:600}.num{white-space:nowrap}.empty{color:#9b9aa8}footer{margin-top:24px;color:#9b9aa8;font-size:10px}`;

export function renderCompanyExportHtml(model: CompanyExportModel, noneLabel: string): string {
  const dir = model.isRtl ? 'rtl' : 'ltr';
  const moneyAlign = model.isRtl ? 'left' : 'right';
  const startAlign = model.isRtl ? 'right' : 'left';
  const body = model.sections
    .map((section) => {
      const head = section.columns
        .map(
          (c, i) =>
            `<th style="text-align:${i === 0 || !isMoneyColumn(section, i) ? startAlign : moneyAlign}">${escapeHtml(c)}</th>`,
        )
        .join('');
      const rows = section.rows.length
        ? section.rows
            .map(
              (r) =>
                `<tr>${r
                  .map((c) =>
                    c.value !== undefined
                      ? `<td class="num" style="text-align:${moneyAlign}">${escapeHtml(c.text)}</td>`
                      : `<td style="text-align:${startAlign}">${escapeHtml(c.text)}</td>`,
                  )
                  .join('')}</tr>`,
            )
            .join('')
        : `<tr><td class="empty" colspan="${section.columns.length}">${escapeHtml(noneLabel)}</td></tr>`;
      return `<h2>${escapeHtml(section.heading)}</h2><table><tr>${head}</tr>${rows}</table>`;
    })
    .join('');
  const headline = model.headline
    .map(
      ([label, value]) =>
        `<div class="head">${escapeHtml(label)}<br><b>${escapeHtml(value)}</b></div>`,
    )
    .join('');
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${STYLE}</style></head><body><h1>${escapeHtml(model.title)}</h1><div class="sub">${escapeHtml(model.subtitle)} · ${escapeHtml(model.generatedOn)}</div>${headline}${body}<footer>${escapeHtml(model.footer)}</footer></body></html>`;
}

/** A column is numeric when every row's cell there carries a number. */
function isMoneyColumn(section: CompanyExportSection, index: number): boolean {
  return section.rows.length > 0 && section.rows.every((r) => r[index]?.value !== undefined);
}

/** A text cell that a spreadsheet would run as a formula is stored as text instead. */
export function safeCellText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function buildCompanyExportWorkbook(model: CompanyExportModel): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const names = new Set<string>();
  const sheetName = (heading: string): string => {
    let base = heading.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Sheet';
    let n = 2;
    while (names.has(base.toLowerCase())) base = `${base.slice(0, 25)} ${n++}`;
    names.add(base.toLowerCase());
    return base;
  };
  const summary: (string | number)[][] = [
    [safeCellText(model.title)],
    [safeCellText(model.subtitle)],
    [model.generatedOn],
    [],
    ...model.headline.map(([label, value]) => [safeCellText(label), safeCellText(value)]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), sheetName(model.title));
  for (const section of model.sections) {
    const rows: (string | number)[][] = [
      section.columns.map(safeCellText),
      ...section.rows.map((r) =>
        r.map((c) => (c.value !== undefined ? c.value : safeCellText(c.text))),
      ),
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(rows),
      sheetName(section.heading),
    );
  }
  return workbook;
}
