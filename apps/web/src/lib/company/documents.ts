/**
 * Estimates and bills: the pure half (payload builders, list maths). Payloads are
 * 1:1 with the phone's `companyDocuments` hooks. The React half is `useCompanyDocs.ts`.
 */

import {
  unpaidBills,
  unpaidBillsTotal,
  type CompanyDocSavePayload,
  type CompanyDocType,
  type DocItemInput,
  type MirrorCompanyDoc,
} from '@waves/core';

export interface DocFormValues {
  readonly docType: CompanyDocType;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly docDate: string;
  readonly items: readonly DocItemInput[];
  readonly discountMinor: bigint;
  readonly notes: string;
  /** The client this document is for; leave out to keep the saved link. */
  readonly clientId?: string | null;
  /** The client's inquiry this document answers; leave out to keep the saved link. */
  readonly inquiryId?: string | null;
}

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined';

export function docSavePayload(docId: string, v: DocFormValues): CompanyDocSavePayload {
  return {
    docId,
    data: {
      docType: v.docType,
      customerName: v.customerName.trim(),
      customerPhone: v.customerPhone.trim().slice(0, 32) || null,
      docDate: v.docDate,
      items: v.items.map((i) => ({
        description: i.description.trim().slice(0, 200),
        qtyMilli: i.qtyMilli.toString(),
        rateMinor: i.rateMinor.toString(),
      })),
      discountMinor: v.discountMinor.toString(),
      notes: v.notes.trim().slice(0, 1000) || null,
      ...(v.clientId === undefined ? {} : { clientId: v.clientId }),
      ...(v.inquiryId === undefined ? {} : { inquiryId: v.inquiryId }),
    },
  };
}

export const docStatusPayload = (docId: string, status: EstimateStatus) => ({ docId, status });
export const docConvertPayload = (docId: string, billId: string) => ({ docId, billId });
export const docVoidPayload = (docId: string) => ({ docId });
export const docPaymentPayload = (
  docId: string,
  paymentId: string,
  amountMinor: bigint,
  paidOn: string,
) => ({ docId, paymentId, amountMinor: amountMinor.toString(), paidOn });

/** Live (not deleted) documents, then the filter chips of the list. */
export type DocFilter = 'all' | 'estimate' | 'bill' | 'unpaid';

export function filterDocs(
  docs: readonly MirrorCompanyDoc[],
  filter: DocFilter,
  query: string,
  label: (d: MirrorCompanyDoc) => string,
): MirrorCompanyDoc[] {
  const live = docs.filter((d) => !d.deleted);
  const q = query.trim().toLowerCase();
  return (
    filter === 'unpaid'
      ? unpaidBills(live)
      : live.filter((d) => filter === 'all' || d.docType === filter)
  ).filter((d) => !q || `${label(d)} ${d.customerName}`.toLowerCase().includes(q));
}

export function docStats(docs: readonly MirrorCompanyDoc[]) {
  const live = docs.filter((d) => !d.deleted);
  const bills = live.filter((d) => d.docType === 'bill');
  const unpaid = unpaidBills(live);
  return {
    total: live.reduce((a, d) => a + d.totalMinor, 0n),
    count: live.length,
    unpaidMinor: unpaidBillsTotal(live),
    unpaidCount: unpaid.length,
    paidMinor: bills.reduce((a, d) => a + d.paidMinor, 0n),
    paidCount: bills.filter((d) => d.paidMinor > 0n).length,
  };
}

/** The estimate's next status buttons. */
export function estimateActions(doc: MirrorCompanyDoc): readonly EstimateStatus[] {
  if (doc.docType !== 'estimate' || doc.convertedTo) return [];
  return doc.status === 'draft' ? ['sent'] : doc.status === 'sent' ? ['accepted', 'declined'] : [];
}
