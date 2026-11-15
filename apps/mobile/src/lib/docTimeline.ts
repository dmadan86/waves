import type { MirrorCompanyDoc } from '@waves/core';

export type DocEventKind = 'created' | 'sent' | 'accepted' | 'declined' | 'payment';

export interface DocEvent {
  readonly kind: DocEventKind;
  /** ISO instant (or a bare payment day). */
  readonly at: string;
  /** Member id of whoever did it, when known. */
  readonly by: string | null;
  readonly amountMinor?: bigint;
  /** A payment day has no time of day. */
  readonly dayOnly?: boolean;
}

/**
 * What happened to a document, newest first, from data that exists: the created
 * stamp, the current estimate status (stamped by the last server write), and
 * each payment. Nothing is invented; an event without a time is left out.
 */
export function docTimeline(doc: MirrorCompanyDoc): DocEvent[] {
  const events: DocEvent[] = [];
  if (doc.createdAt) events.push({ kind: 'created', at: doc.createdAt, by: doc.createdBy });
  if (
    doc.docType === 'estimate' &&
    doc.updatedAt &&
    (doc.status === 'sent' || doc.status === 'accepted' || doc.status === 'declined')
  )
    events.push({ kind: doc.status, at: doc.updatedAt, by: doc.updatedBy ?? null });
  for (const p of doc.payments)
    events.push({
      kind: 'payment',
      at: p.paidOn,
      by: null,
      amountMinor: p.amountMinor,
      dayOnly: true,
    });
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The "Accepted / Declined / Paid" stamp for the customer card's right half, or null. */
export function closingStamp(
  doc: MirrorCompanyDoc,
): { kind: 'accepted' | 'declined' | 'paid'; at: string; by: string } | null {
  const kind =
    doc.docType === 'bill'
      ? doc.status === 'paid'
        ? 'paid'
        : null
      : doc.status === 'accepted' || doc.status === 'declined'
        ? doc.status
        : null;
  return kind && doc.updatedAt && doc.updatedBy
    ? { kind, at: doc.updatedAt, by: doc.updatedBy }
    : null;
}
