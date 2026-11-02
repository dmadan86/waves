/** Pure rules behind the Clients list: each client's status, latest document, last activity and amount, from its linked documents. */

import {
  billDueMinor,
  type ClientNote,
  type CompanyClient,
  type MirrorCompanyDoc,
} from '@waves/core';

export type ClientStatus =
  'inquiry' | 'quoted' | 'unpaid' | 'part_paid' | 'paid' | 'client' | 'lost';
export type ClientDoc = Pick<
  MirrorCompanyDoc,
  | 'docType'
  | 'number'
  | 'docDate'
  | 'totalMinor'
  | 'paidMinor'
  | 'payments'
  | 'clientId'
  | 'deleted'
>;

const dayNum = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));

export interface ClientRow {
  readonly client: CompanyClient;
  readonly status: ClientStatus;
  /** The most recent document (by its date; the first listed wins a tie), if any. */
  readonly latest: { readonly type: 'estimate' | 'bill'; readonly number: number | null } | null;
  /** ISO day of the latest document, payment, note or the client's creation. */
  readonly lastDay: string;
  /** What is still owed, else the latest document's total; null when nothing is quoted or billed. */
  readonly amountMinor: bigint | null;
  readonly dueMinor: bigint;
  readonly hasEstimate: boolean;
  readonly hasBill: boolean;
  /** ISO day of the soonest open follow-up, if any. */
  readonly nextFollowUp: string | null;
}

/** Soonest open follow-up day per client, from tasks linked to a client. */
export function nextFollowUpDays(
  tasks: readonly { clientId?: string | null; day: string; status: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tasks) {
    if (!t.clientId || t.status === 'done') continue;
    const cur = out.get(t.clientId);
    if (!cur || t.day < cur) out.set(t.clientId, t.day);
  }
  return out;
}

export type FollowUpTag =
  { kind: 'today' } | { kind: 'overdue'; n: number } | { kind: 'on'; weekday: boolean };

/** How a follow-up day reads on a client row: today, overdue by n days, else a weekday (within 7 days) or a date. */
export function followUpTag(day: string, today: string): FollowUpTag {
  const n = Math.round((dayNum(day) - dayNum(today)) / 86_400_000);
  return n === 0
    ? { kind: 'today' }
    : n < 0
      ? { kind: 'overdue', n: -n }
      : { kind: 'on', weekday: n <= 7 };
}

export function buildClientRows(
  clients: readonly CompanyClient[],
  docs: readonly ClientDoc[],
  notes: readonly Pick<ClientNote, 'clientId' | 'createdAt'>[] = [],
  followUps: ReadonlyMap<string, string> = new Map(),
): ClientRow[] {
  const byClient = new Map<string, ClientDoc[]>();
  for (const d of docs) {
    if (d.deleted || !d.clientId) continue;
    byClient.set(d.clientId, [...(byClient.get(d.clientId) ?? []), d]);
  }
  const noteDay = new Map<string, string>();
  for (const n of notes) {
    const day = n.createdAt.slice(0, 10);
    if (day > (noteDay.get(n.clientId) ?? '')) noteDay.set(n.clientId, day);
  }
  return clients.map((client) => {
    const mine = byClient.get(client.id) ?? [];
    let latestDoc: ClientDoc | null = null;
    let lastDay = client.createdAt.slice(0, 10);
    const noted = noteDay.get(client.id) ?? '';
    if (noted > lastDay) lastDay = noted;
    for (const d of mine) {
      if (!latestDoc || d.docDate > latestDoc.docDate) latestDoc = d;
      if (d.docDate > lastDay) lastDay = d.docDate;
      for (const p of d.payments) if (p.paidOn > lastDay) lastDay = p.paidOn;
    }
    const bills = mine.filter((d) => d.docType === 'bill');
    const open = bills.filter((d) => d.paidMinor < d.totalMinor);
    const dueMinor = open.reduce((n, d) => n + billDueMinor(d.totalMinor, d.paidMinor), 0n);
    const status: ClientStatus =
      client.stage === 'lost'
        ? 'lost'
        : open.length > 0
          ? open.some((d) => d.paidMinor > 0n)
            ? 'part_paid'
            : 'unpaid'
          : bills.length > 0
            ? 'paid'
            : mine.length > 0 || client.stage === 'quoted'
              ? 'quoted'
              : client.stage === 'client'
                ? 'client'
                : 'inquiry';
    return {
      client,
      status,
      latest: latestDoc ? { type: latestDoc.docType, number: latestDoc.number } : null,
      lastDay,
      amountMinor:
        dueMinor > 0n ? dueMinor : latestDoc ? latestDoc.totalMinor : client.expectedValueMinor,
      dueMinor,
      hasEstimate: mine.some((d) => d.docType === 'estimate'),
      hasBill: bills.length > 0,
      nextFollowUp: followUps.get(client.id) ?? null,
    };
  });
}

export type ClientTab = 'all' | 'inquiry' | 'quote' | 'invoice';
export type DateRange = 'all' | 'month' | 'quarter';
export type ClientSort = 'recent' | 'amount' | 'name';

/** Lost clients show only under the Lost status filter. A client with a quote and an invoice is in both tabs. */
export function inTab(r: ClientRow, tab: ClientTab): boolean {
  if (r.status === 'lost') return false;
  return tab === 'all'
    ? true
    : tab === 'inquiry'
      ? r.status === 'inquiry'
      : tab === 'quote'
        ? r.hasEstimate || r.status === 'quoted'
        : r.hasBill;
}

export function tabCounts(rows: readonly ClientRow[]): Record<ClientTab, number> {
  const n = (tab: ClientTab) => rows.filter((r) => inTab(r, tab)).length;
  return { all: n('all'), inquiry: n('inquiry'), quote: n('quote'), invoice: n('invoice') };
}

/** Whole days from `day` to `today`, never negative. */
export const daysAgo = (day: string, today: string): number =>
  Math.max(0, Math.round((dayNum(today) - dayNum(day)) / 86_400_000));

export function listClientRows(
  rows: readonly ClientRow[],
  o: {
    tab: ClientTab;
    status: ClientStatus | null;
    range: DateRange;
    sort: ClientSort;
    query: string;
    today: string;
    /** Only clients who still owe, whatever their stage or tab (the Outstanding tile). */
    owing?: boolean;
  },
): ClientRow[] {
  const q = o.query.trim().toLocaleLowerCase();
  const inRange = (r: ClientRow) =>
    o.range === 'all' ||
    (o.range === 'month'
      ? r.lastDay.slice(0, 7) === o.today.slice(0, 7)
      : daysAgo(r.lastDay, o.today) <= 90);
  return rows
    .filter((r) =>
      o.owing
        ? r.dueMinor > 0n
        : o.status
          ? r.status === o.status && (o.tab === 'all' || inTab(r, o.tab))
          : inTab(r, o.tab),
    )
    .filter(inRange)
    .filter(
      (r) =>
        !q ||
        [r.client.name, r.client.phone, r.client.need].some((v) =>
          v?.toLocaleLowerCase().includes(q),
        ),
    )
    .sort((a, b) => {
      if (o.sort === 'name') return a.client.name.localeCompare(b.client.name);
      if (o.sort === 'amount') {
        const d = (b.amountMinor ?? -1n) - (a.amountMinor ?? -1n);
        if (d !== 0n) return d > 0n ? 1 : -1;
      }
      return b.lastDay.localeCompare(a.lastDay) || a.client.name.localeCompare(b.client.name);
    });
}
