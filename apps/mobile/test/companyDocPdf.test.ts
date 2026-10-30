import { describe, expect, it } from 'vitest';
import { format, money, type MirrorCompanyDoc } from '@waves/core';
import { renderCompanyDocHtml, type CompanyDocPdfLabels } from '../src/lib/companyDocPdf';

const labels: CompanyDocPdfLabels = {
  estimate: 'Estimate',
  bill: 'Bill',
  date: 'Date',
  billTo: 'Bill to',
  estimateFor: 'Estimate for',
  description: 'Description',
  qty: 'Qty',
  rate: 'Rate',
  amount: 'Amount',
  subtotal: 'Subtotal',
  discount: 'Discount',
  total: 'Total',
  payments: 'Payments received',
  amountLeft: 'Balance due',
  notes: 'Notes',
  footer: 'This is not a tax invoice.',
};
const doc: MirrorCompanyDoc = {
  id: 'doc',
  groupId: 'group',
  docType: 'estimate',
  number: 1,
  customerName: '<script>alert("x")</script>',
  customerPhone: '<phone>',
  docDate: '2026-10-30',
  items: [
    {
      description: '<script>item</script>',
      qtyMilli: 1500n,
      rateMinor: 10000n,
      amountMinor: 15000n,
    },
  ],
  discountMinor: 0n,
  totalMinor: 15000n,
  currency: 'INR',
  notes: '<script>note</script>',
  status: 'draft',
  payments: [],
  paidMinor: 0n,
  convertedTo: null,
  convertedFrom: null,
  createdBy: 'owner',
  deleted: false,
  pending: false,
};
const render = (value = doc, logoUrl?: string) =>
  renderCompanyDocHtml(value, {
    companyName: '<script>Company</script>',
    logoUrl,
    labels,
    formatMoney: (minor) => format(money(minor, 'INR'), { locale: 'en-IN' }),
    formatDate: (date) => date,
  });

describe('company document PDF', () => {
  it('uses the exact legal footer and only the permitted wording', () => {
    const html = render();
    expect(html).toContain('This is not a tax invoice.');
    expect(html.replace('This is not a tax invoice.', '')).not.toMatch(
      /tax invoice|GSTIN|GST|Collect/i,
    );
    expect(html).toContain('EST-0001');
  });
  it('escapes all customer, company, item, phone and note text', () => {
    const html = render();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;phone&gt;');
    expect(html).toContain('&quot;x&quot;');
  });
  it('shows payments and balance due for a part-paid bill', () => {
    const html = render({
      ...doc,
      docType: 'bill',
      status: 'part_paid',
      paidMinor: 5000n,
      payments: [{ id: 'payment', amountMinor: 5000n, paidOn: '2026-10-30' }],
    });
    expect(html).toContain('BILL-0001');
    expect(html).toContain('Balance due');
    expect(html).toContain(format(money(10000n, 'INR'), { locale: 'en-IN' }));
    expect(html).toContain('Payments received');
    expect(html).not.toMatch(/Collect/i);
  });
  it('includes only usable remote logos and escapes their attributes', () => {
    for (const url of [
      undefined,
      'file:///private/logo.png',
      'javascript:alert(1)',
      'data:image/png;base64,abc',
      'https://',
    ])
      expect(render(doc, url)).not.toContain('<img');
    expect(render(doc, 'https://example.com/logo?a=1&b=2')).toContain(
      'src="https://example.com/logo?a=1&amp;b=2"',
    );
  });
});
