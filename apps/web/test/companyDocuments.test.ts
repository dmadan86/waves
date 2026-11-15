import { describe, expect, it } from 'vitest';

import { type MirrorCompanyDoc } from '@waves/core';

import {
  docPaymentPayload,
  docSavePayload,
  docStats,
  estimateActions,
  filterDocs,
} from '@/lib/company/documents';
import { buildCompanyExportCsv, safeCellText, type CompanyExportModel } from '@/lib/company/export';
import { percentToMinor } from '@/lib/company/discount';
import { periodRange } from '@/lib/company/period';

const doc = (over: Partial<MirrorCompanyDoc>): MirrorCompanyDoc =>
  ({
    id: 'd',
    docType: 'bill',
    number: 1,
    customerName: 'Acme',
    totalMinor: 1000n,
    paidMinor: 0n,
    status: 'unpaid',
    deleted: false,
    convertedTo: null,
    ...over,
  }) as unknown as MirrorCompanyDoc;

describe('company documents', () => {
  it('builds the save payload like the phone', () => {
    const p = docSavePayload('id1', {
      docType: 'bill',
      customerName: ' Acme ',
      customerPhone: '',
      docDate: '2026-01-02',
      items: [{ description: ' Bolt ', qtyMilli: 2000n, rateMinor: 500n }],
      discountMinor: 100n,
      notes: '  ',
    });
    expect(p).toEqual({
      docId: 'id1',
      data: {
        docType: 'bill',
        customerName: 'Acme',
        customerPhone: null,
        docDate: '2026-01-02',
        items: [{ description: 'Bolt', qtyMilli: '2000', rateMinor: '500' }],
        discountMinor: '100',
        notes: null,
      },
    });
  });

  it('keeps client links only when given', () => {
    const base = {
      docType: 'estimate',
      customerName: 'A',
      customerPhone: '',
      docDate: 'x',
      items: [],
      discountMinor: 0n,
      notes: '',
    } as const;
    expect('clientId' in docSavePayload('i', base).data).toBe(false);
    expect(docSavePayload('i', { ...base, clientId: 'c' }).data).toMatchObject({ clientId: 'c' });
  });

  it('stringifies the payment amount', () => {
    expect(docPaymentPayload('d', 'p', 5n, '2026-01-01')).toEqual({
      docId: 'd',
      paymentId: 'p',
      amountMinor: '5',
      paidOn: '2026-01-01',
    });
  });

  it('filters and counts', () => {
    const docs = [
      doc({ id: 'a' }),
      doc({ id: 'b', docType: 'estimate', status: 'draft' }),
      doc({ id: 'c', deleted: true }),
    ];
    const label = (d: MirrorCompanyDoc) => d.docType;
    expect(filterDocs(docs, 'all', '', label).map((d) => d.id)).toEqual(['a', 'b']);
    expect(filterDocs(docs, 'estimate', '', label).map((d) => d.id)).toEqual(['b']);
    expect(filterDocs(docs, 'unpaid', 'acme', label).map((d) => d.id)).toEqual(['a']);
    expect(docStats(docs).count).toBe(2);
  });

  it('offers estimate next steps', () => {
    expect(estimateActions(doc({ docType: 'estimate', status: 'draft' }))).toEqual(['sent']);
    expect(estimateActions(doc({ docType: 'estimate', status: 'sent' }))).toEqual([
      'accepted',
      'declined',
    ]);
    expect(estimateActions(doc({ docType: 'bill' }))).toEqual([]);
  });

  it('percent discount rounds half up and caps', () => {
    expect(percentToMinor(1000n, '12.5')).toBe(125n);
    expect(percentToMinor(1000n, '101')).toBe(0n);
  });

  it('period range', () => {
    expect(periodRange('last', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('company export csv', () => {
  it('neutralises formulas and quotes', () => {
    expect(safeCellText('=1+1')).toBe("'=1+1");
    const model: CompanyExportModel = {
      title: 'T',
      subtitle: 'S',
      generatedOn: '2026-01-01',
      headline: [['a', 'b']],
      isRtl: false,
      footer: '',
      sections: [
        {
          heading: 'H',
          columns: ['c1', 'c2'],
          rows: [[{ text: '@x' }, { text: '1.00', value: 1 }]],
        },
      ],
    };
    const csv = buildCompanyExportCsv(model);
    expect(csv).toContain('"\'@x","1"');
    expect(csv.startsWith('﻿')).toBe(true);
  });
});
