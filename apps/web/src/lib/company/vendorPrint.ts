/** Printable HTML for a vendor statement, receipt and purchase order (port of mobile vendorPdf.ts); printed with window.print. */
import {
  orderLabel,
  orderLineTotal,
  orderTotal,
  receiptLabel,
  receiptStatus,
  type VendorOrder,
  type VendorReceipt,
  type VendorStatementRow,
} from '@waves/core';

import { trimQty } from '@/lib/company/vendorOrders';

export const esc = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const CSS = `body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1c1b2e;padding:32px}
.brand{color:#5B3FD9;font-weight:800;font-size:20px}h1{font-size:22px;margin:4px 0 16px}
table{width:100%;border-collapse:collapse}td,th{padding:8px 4px;border-bottom:1px solid #e6e4f2;text-align:left;font-size:14px}
.num{text-align:right;font-variant-numeric:tabular-nums}.k{color:#6b6880;width:38%}
.big{font-size:26px;font-weight:800;color:#5B3FD9}.foot{margin-top:28px;color:#6b6880;font-size:12px}`;

const page = (body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;

export interface PrintFormat {
  money: (minor: bigint) => string;
  date: (iso: string) => string;
}

export function renderReceiptHtml(
  r: VendorReceipt,
  company: string,
  l: Record<string, string>,
  methods: Record<string, string>,
  f: PrintFormat,
): string {
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const status = { pending: l.waitingSync, received: l.received, recorded: l.recorded }[
    receiptStatus(r)
  ]!;
  return page(`<div class="brand">Waves</div><h1>${esc(l.receiptTitle!)} ${esc(receiptLabel(r.receiptNo))}</h1>
<div class="big">${esc(f.money(r.amount))}</div><table>
${row(l.companyLabel!, company)}${row(l.vendorLabel!, r.vendorName)}${row(l.dateLabel!, f.date(r.date))}
${r.method ? row(l.method!, methods[r.method] ?? r.method) : ''}${r.reference ? row(l.reference!, r.reference) : ''}
${row(l.balanceAfter!, r.balanceAfter < 0n ? `${f.money(-r.balanceAfter)} ${l.advance}` : f.money(r.balanceAfter))}
${row(l.statusLabel!, status)}</table>
<div class="foot">${esc(l.receiptFooter!)}</div>`);
}

export function renderStatementHtml(
  vendorName: string,
  company: string,
  rows: readonly VendorStatementRow[],
  balance: bigint,
  l: Record<string, string>,
  f: PrintFormat,
): string {
  const kinds: Record<string, string> = { bill: l.bill!, advance: l.advance!, payment: l.payment! };
  const body = rows
    .map(
      (r) =>
        `<tr><td>${esc(f.date(r.date))}</td><td>${esc(kinds[r.kind] ?? r.kind)}${
          r.receiptNo ? ` ${esc(receiptLabel(r.receiptNo))}` : ''
        }${r.note ? ` · ${esc(r.note)}` : ''}</td><td class="num">${esc(
          `${r.signed < 0n ? '−' : ''}${f.money(r.signed < 0n ? -r.signed : r.signed)}`,
        )}</td><td class="num">${esc(f.money(r.balance))}</td></tr>`,
    )
    .join('');
  return page(`<div class="brand">Waves</div><h1>${esc(l.statementTitle!)}</h1><p>${esc(company)} · ${esc(vendorName)}</p>
<table><tr><th>${esc(l.dateLabel!)}</th><th></th><th class="num">${esc(l.amountLabel!)}</th><th class="num">${esc(l.balance!)}</th></tr>${body}</table>
<p class="big">${esc(l.balance!)}: ${esc(f.money(balance))}</p>`);
}

export function renderOrderHtml(
  o: VendorOrder,
  vendorName: string,
  company: string,
  l: Record<string, string>,
  units: Record<string, string>,
  f: PrintFormat,
): string {
  const rows = o.items
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}</td><td>${esc(trimQty(i.qty))} ${esc(units[i.unit] ?? i.unit)}</td><td class="num">${esc(
          f.money(i.unitPrice),
        )}</td><td class="num">${esc(f.money(orderLineTotal(i.qty, i.unitPrice)))}</td></tr>`,
    )
    .join('');
  return page(`<div class="brand">Waves</div><h1>${esc(l.purchaseOrder!)} ${esc(orderLabel(o.orderNo))}</h1>
<p>${esc(l.companyLabel!)}: ${esc(company)}<br>${esc(l.vendorLabel!)}: ${esc(vendorName)}${
    o.expectedOn ? `<br>${esc(l.expectedOn!.replace('{date}', f.date(o.expectedOn)))}` : ''
  }</p>
<table><tr><th>${esc(l.itemName!)}</th><th>${esc(l.itemQty!)}</th><th class="num"></th><th class="num">${esc(l.amountLabel!)}</th></tr>${rows}</table>
<p class="big">${esc(l.orderTotal!)}: ${esc(f.money(orderTotal(o.items)))}</p>${o.note ? `<p>${esc(o.note)}</p>` : ''}`);
}

/** Print an HTML document through a hidden iframe (the browser's print dialog also saves as PDF). */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
