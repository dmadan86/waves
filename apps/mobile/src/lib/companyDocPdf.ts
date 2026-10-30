import {
  billDueMinor,
  computeDocTotals,
  docNumberLabel,
  formatQty,
  lineAmount,
  type MirrorCompanyDoc,
} from '@waves/core';

export interface CompanyDocPdfLabels {
  estimate: string;
  bill: string;
  date: string;
  billTo: string;
  estimateFor: string;
  description: string;
  qty: string;
  rate: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  payments: string;
  amountLeft: string;
  notes: string;
  footer: string;
}
export interface CompanyDocPdfOptions {
  companyName: string;
  logoUrl?: string | null;
  labels: CompanyDocPdfLabels;
  formatMoney: (minor: bigint) => string;
  formatDate: (date: string) => string;
}
const escape = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function renderCompanyDocHtml(doc: MirrorCompanyDoc, options: CompanyDocPdfOptions): string {
  const { labels: l, formatMoney, formatDate } = options;
  const money = (v: bigint) => escape(formatMoney(v));
  const row = (label: string, value: bigint) =>
    `<tr><td>${escape(label)}</td><td class="num">${money(value)}</td></tr>`;
  let logo = '';
  try {
    const url = new URL(options.logoUrl ?? '');
    if (
      ['https:', 'http:'].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
    )
      logo = `<img alt="" src="${escape(url.href)}">`;
  } catch {
    /* No usable remote logo. */
  }
  const totals = computeDocTotals(doc.items, doc.discountMinor);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:20mm}body{font:13px Arial,sans-serif;color:#242238}header{display:flex;align-items:center;gap:16px}img{width:64px;height:64px;object-fit:contain}h1{font-size:24px}h2{font-size:16px}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:start;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.num{text-align:end;white-space:nowrap}.summary{margin-inline-start:auto;width:55%}p{white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:10px;color:#777;margin-top:36px}</style></head><body>
  <header>${logo}<h1>${escape(options.companyName)}</h1></header>
  <h2>${escape(doc.docType === 'estimate' ? l.estimate : l.bill)} · ${escape(docNumberLabel(doc.docType, doc.number))}</h2>
  <p>${escape(l.date)}: ${escape(formatDate(doc.docDate))}</p>
  <h2>${escape(doc.docType === 'estimate' ? l.estimateFor : l.billTo)}</h2><p>${escape(doc.customerName)}${doc.customerPhone ? `<br>${escape(doc.customerPhone)}` : ''}</p>
  <table><thead><tr>${[l.description, l.qty, l.rate, l.amount].map((v) => `<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${doc.items.map((i) => `<tr><td>${escape(i.description)}</td><td>${escape(formatQty(i.qtyMilli))}</td><td class="num">${money(i.rateMinor)}</td><td class="num">${money(lineAmount(i))}</td></tr>`).join('')}</tbody></table>
  <table class="summary">${row(l.subtotal, totals.subtotalMinor)}${row(l.discount, doc.discountMinor)}${row(l.total, doc.totalMinor)}${doc.docType === 'bill' ? row(l.payments, doc.paidMinor) + row(l.amountLeft, billDueMinor(doc.totalMinor, doc.paidMinor)) : ''}</table>
  ${doc.docType === 'bill' && doc.payments.length ? `<h2>${escape(l.payments)}</h2><table>${doc.payments.map((p) => `<tr><td>${escape(formatDate(p.paidOn))}</td><td class="num">${money(p.amountMinor)}</td></tr>`).join('')}</table>` : ''}
  ${doc.notes ? `<h2>${escape(l.notes)}</h2><p>${escape(doc.notes)}</p>` : ''}<footer>${escape(l.footer)}</footer></body></html>`;
}
