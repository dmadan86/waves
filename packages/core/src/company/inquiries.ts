/**
 * A client has many inquiries (INQ-001, INQ-002, ...). Only a rejection is stored; every other status is derived
 * from the estimates and bills linked to the inquiry, so it can never disagree with the documents.
 */

export type InquiryStatus = 'open' | 'quoted' | 'won' | 'rejected';

export interface CompanyInquiry {
  readonly id: string;
  readonly clientId: string;
  /** Per-company running number: shown as INQ-004. */
  readonly number: number;
  readonly title: string;
  readonly details: string | null;
  readonly expectedValueMinor: bigint | null;
  /** ISO day. */
  readonly inquiryDate: string;
  readonly rejectedAt: string | null;
  readonly rejectReason: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly pending?: boolean;
}

/** The slice of an estimate or bill that matters here. */
export interface InquiryDoc {
  readonly id: string;
  readonly docType: 'estimate' | 'bill';
  readonly status: string;
  readonly docDate: string;
  readonly number: number | null;
  readonly totalMinor: bigint;
  readonly paidMinor: bigint;
  readonly convertedTo: string | null;
  readonly inquiryId?: string | null;
  readonly clientId?: string | null;
  readonly deleted: boolean;
}

/** INQ-004; an inquiry still waiting for the server's number reads INQ-—. */
export const inquiryLabel = (n: number): string =>
  n > 0 ? `INQ-${String(n).padStart(3, '0')}` : 'INQ-—';

/** Live documents linked to one inquiry. */
export function inquiryDocs<D extends InquiryDoc>(inquiryId: string, docs: readonly D[]): D[] {
  return docs.filter((d) => !d.deleted && d.inquiryId === inquiryId);
}

/**
 * rejected if rejected; won if a linked estimate was accepted or converted to a bill, or a linked bill exists;
 * quoted if a linked estimate (draft or sent) exists; otherwise open. A declined estimate does not count as a quote.
 */
export function inquiryStatus(inq: CompanyInquiry, docs: readonly InquiryDoc[]): InquiryStatus {
  if (inq.rejectedAt) return 'rejected';
  const mine = inquiryDocs(inq.id, docs);
  if (
    mine.some(
      (d) =>
        d.docType === 'bill' ||
        (d.docType === 'estimate' && (d.status === 'accepted' || d.convertedTo !== null)),
    )
  )
    return 'won';
  if (mine.some((d) => d.docType === 'estimate' && d.status !== 'declined')) return 'quoted';
  return 'open';
}

const newest = (a: InquiryDoc, b: InquiryDoc) =>
  b.docDate.localeCompare(a.docDate) ||
  (b.number ?? 0) - (a.number ?? 0) ||
  b.id.localeCompare(a.id);

/** The linked bill's total (newest) if any, else the newest live estimate's, else what was expected. */
export function inquiryAmount(inq: CompanyInquiry, docs: readonly InquiryDoc[]): bigint | null {
  const mine = inquiryDocs(inq.id, docs).sort(newest);
  const doc =
    mine.find((d) => d.docType === 'bill') ??
    mine.find((d) => d.docType === 'estimate' && d.status !== 'declined');
  return doc ? doc.totalMinor : inq.expectedValueMinor;
}

/** Newest inquiry first: by its date, then its number. */
export function sortInquiries<T extends Pick<CompanyInquiry, 'inquiryDate' | 'number'>>(
  list: readonly T[],
): T[] {
  return [...list].sort(
    (a, b) => b.inquiryDate.localeCompare(a.inquiryDate) || b.number - a.number,
  );
}

export interface ClientInquiryStats {
  readonly total: number;
  readonly won: number;
  readonly rejected: number;
  /** Money received on this client's bills. */
  readonly paidMinor: bigint;
}

export function clientInquiryStats(
  inquiries: readonly CompanyInquiry[],
  docs: readonly InquiryDoc[],
): ClientInquiryStats {
  let won = 0;
  let rejected = 0;
  for (const i of inquiries) {
    const s = inquiryStatus(i, docs);
    if (s === 'won') won += 1;
    else if (s === 'rejected') rejected += 1;
  }
  const paidMinor = docs
    .filter((d) => !d.deleted && d.docType === 'bill')
    .reduce((n, d) => n + d.paidMinor, 0n);
  return { total: inquiries.length, won, rejected, paidMinor };
}
