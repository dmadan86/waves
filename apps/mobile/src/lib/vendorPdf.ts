import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { receiptLabel, type VendorStatementRow, type VendorReceipt } from '@waves/core';

import { printAvailable, printHtmlToFile } from '@/lib/print';

const esc = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const BRAND = '#5B3FD9';
const CSS = `body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1c1b2e;padding:32px}
.brand{color:${BRAND};font-weight:800;font-size:20px}h1{font-size:22px;margin:4px 0 16px}
table{width:100%;border-collapse:collapse}td,th{padding:8px 4px;border-bottom:1px solid #e6e4f2;text-align:left;font-size:14px}
.num{text-align:right;font-variant-numeric:tabular-nums}.k{color:#6b6880;width:38%}
.big{font-size:26px;font-weight:800;color:${BRAND}}.foot{margin-top:28px;color:#6b6880;font-size:12px}`;

export interface PdfFormat {
  money: (minor: bigint) => string;
  date: (iso: string) => string;
}

export interface ReceiptLabels {
  receiptTitle: string;
  companyLabel: string;
  vendorLabel: string;
  dateLabel: string;
  amountLabel: string;
  method: string;
  reference: string;
  balanceAfter: string;
  advance: string;
  statusLabel: string;
  recorded: string;
  received: string;
  receiptFooter: string;
  methods: Record<string, string>;
}

export function renderReceiptHtml(
  r: VendorReceipt,
  company: string,
  l: ReceiptLabels,
  f: PdfFormat,
): string {
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="brand">Waves</div><h1>${esc(l.receiptTitle)} ${esc(receiptLabel(r.receiptNo))}</h1>
<div class="big">${esc(f.money(r.amount))}</div><table>
${row(l.companyLabel, company)}${row(l.vendorLabel, r.vendorName)}${row(l.dateLabel, f.date(r.date))}
${r.method ? row(l.method, l.methods[r.method] ?? r.method) : ''}${r.reference ? row(l.reference, r.reference) : ''}
${row(l.balanceAfter, r.balanceAfter < 0n ? `${f.money(-r.balanceAfter)} ${l.advance}` : f.money(r.balanceAfter))}
${row(l.statusLabel, r.received ? l.received : l.recorded)}</table>
<div class="foot">${esc(l.receiptFooter)}</div></body></html>`;
}

export interface StatementLabels {
  statementTitle: string;
  dateLabel: string;
  amountLabel: string;
  balance: string;
  kinds: Record<string, string>;
}

export function renderStatementHtml(
  vendorName: string,
  company: string,
  rows: readonly VendorStatementRow[],
  balance: bigint,
  l: StatementLabels,
  f: PdfFormat,
): string {
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(f.date(r.date))}</td><td>${esc(l.kinds[r.kind] ?? r.kind)}${
          r.receiptNo ? ` ${esc(receiptLabel(r.receiptNo))}` : ''
        }${r.note ? ` · ${esc(r.note)}` : ''}</td><td class="num">${esc(
          `${r.signed < 0n ? '−' : ''}${f.money(r.signed < 0n ? -r.signed : r.signed)}`,
        )}</td><td class="num">${esc(f.money(r.balance))}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<div class="brand">Waves</div><h1>${esc(l.statementTitle)}</h1><p>${esc(company)} · ${esc(vendorName)}</p>
<table><tr><th>${esc(l.dateLabel)}</th><th></th><th class="num">${esc(l.amountLabel)}</th><th class="num">${esc(l.balance)}</th></tr>${body}</table>
<p class="big">${esc(l.balance)}: ${esc(f.money(balance))}</p></body></html>`;
}

/** Render and open the share sheet. False when printing/sharing is unavailable. */
export async function shareHtmlAsPdf(html: string, title: string): Promise<boolean> {
  if (!printAvailable()) return false;
  const uri = await printHtmlToFile(html);
  if (!uri) return false;
  const file = new FileSystem.File(uri);
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: title,
    });
    return true;
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      /* Best-effort privacy cleanup. */
    }
  }
}
