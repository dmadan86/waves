import type { ClientPriority, ClientSource, ClientStage } from '../sync/protocol';
import { addDays } from '../trip/timeline';
import { billDueMinor, type DocSummaryRow } from './documents';

export type { ClientSource, ClientStage };

export const CLIENT_SOURCES: readonly ClientSource[] = [
  'walk_in',
  'call',
  'whatsapp',
  'referral',
  'other',
];

export interface CompanyClient {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly need: string | null;
  readonly source: ClientSource;
  readonly expectedValueMinor: bigint | null;
  readonly address: string | null;
  readonly email: string | null;
  /** The customer's own company (not this one). */
  readonly companyName: string | null;
  readonly category: string | null;
  readonly priority: ClientPriority;
  readonly stage: ClientStage;
  readonly lostReason: string | null;
  /** The member who follows up (employee, manager or owner). */
  readonly ownerMemberId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly pending?: boolean;
}

/** One person assigned to a client (the primary owner is always among them). */
export interface ClientAssignee {
  readonly clientId: string;
  readonly memberId: string;
}

export interface ClientNote {
  readonly id: string;
  readonly clientId: string;
  readonly body: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly pending?: boolean;
}

/** 'all' is every client that is not lost; lost ones have their own filter. */
export type ClientFilter = 'all' | 'inquiry' | 'quoted' | 'client' | 'lost';

export function clientCounts(clients: readonly CompanyClient[]): Record<ClientFilter, number> {
  const out: Record<ClientFilter, number> = { all: 0, inquiry: 0, quoted: 0, client: 0, lost: 0 };
  for (const c of clients) {
    out[c.stage] += 1;
    if (c.stage !== 'lost') out.all += 1;
  }
  return out;
}

/** The list for one chip, filtered by name, phone or need, newest first. */
export function filterClients(
  clients: readonly CompanyClient[],
  filter: ClientFilter,
  search = '',
): CompanyClient[] {
  const q = search.trim().toLocaleLowerCase();
  return clients
    .filter((c) => (filter === 'all' ? c.stage !== 'lost' : c.stage === filter))
    .filter((c) => !q || [c.name, c.phone, c.need].some((v) => v?.toLocaleLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

/** What a client still owes: unpaid bill balances linked to each client, and the sum of them. */
export function clientsToReceive(
  docs: readonly (DocSummaryRow & { readonly clientId?: string | null })[],
): { readonly byClient: Map<string, bigint>; readonly total: bigint } {
  const byClient = new Map<string, bigint>();
  let total = 0n;
  for (const d of docs) {
    if (d.deleted || d.docType !== 'bill' || !d.clientId || d.paidMinor >= d.totalMinor) continue;
    const due = billDueMinor(d.totalMinor, d.paidMinor);
    byClient.set(d.clientId, (byClient.get(d.clientId) ?? 0n) + due);
    total += due;
  }
  return { byClient, total };
}

export interface FollowUpRow {
  readonly id: string;
  readonly day: string;
  readonly dueTime: string | null;
  readonly status: 'todo' | 'doing' | 'done' | 'blocked';
  readonly clientId?: string | null;
}
export interface FollowUpGroups<T> {
  readonly overdue: T[];
  readonly today: T[];
  readonly week: T[];
  readonly later: T[];
}

/**
 * Open tasks linked to a client, grouped Overdue (before today), Today, This week (the next 7 days) and Later,
 * each sorted by day then time. Done tasks and tasks without a client are left out.
 */
export function groupFollowUps<T extends FollowUpRow>(
  tasks: readonly T[],
  today: string,
): FollowUpGroups<T> {
  const out: FollowUpGroups<T> = { overdue: [], today: [], week: [], later: [] };
  const weekEnd = addDays(today, 7);
  const sorted = tasks
    .filter((t) => t.clientId && t.status !== 'done')
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
        a.id.localeCompare(b.id),
    );
  for (const t of sorted) {
    if (t.day < today) out.overdue.push(t);
    else if (t.day === today) out.today.push(t);
    else if (t.day <= weekEnd) out.week.push(t);
    else out.later.push(t);
  }
  return out;
}

export type NextFollowUp = 'tomorrow' | 'three_days' | 'next_week' | 'none';
/** The day for the next follow-up after "Done"; null when there is no more follow-up. */
export function nextFollowUpDay(choice: NextFollowUp, today: string): string | null {
  return choice === 'tomorrow'
    ? addDays(today, 1)
    : choice === 'three_days'
      ? addDays(today, 3)
      : choice === 'next_week'
        ? addDays(today, 7)
        : null;
}
