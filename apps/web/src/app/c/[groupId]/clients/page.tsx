'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Users } from 'lucide-react';

import { SegmentedTabs } from '@/components/SegmentedTabs';
import { EmptyState } from '@/components/EmptyState';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { money } from '@/lib/money';
import {
  buildClientRows,
  listClientRows,
  nextFollowUpDays,
  tabCounts,
  type ClientSort,
  type ClientStatus,
  type ClientTab,
  type DateRange,
} from '@/lib/company/clientRows';
import { CompanyPage } from '@/lib/company/ClientParts';
import {
  useClientDocs,
  useCompanyClients,
  useCompanyTickets,
  useFollowUps,
} from '@/lib/company/useClients';
import { todayIso } from '@/lib/company/view';

const STATUSES: readonly ClientStatus[] = [
  'inquiry',
  'quoted',
  'unpaid',
  'part_paid',
  'paid',
  'rejected',
  'lost',
];

export default function ClientsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { t, locale } = useStrings();
  const s = t.company.clients;
  const view = useCompanyClients(groupId);
  const tickets = useCompanyTickets(groupId);
  const docs = useClientDocs(groupId);
  const followUps = useFollowUps(groupId);
  const [tab, setTab] = useState<ClientTab>('all');
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [range, setRange] = useState<DateRange>('all');
  const [sort, setSort] = useState<ClientSort>('recent');
  const [query, setQuery] = useState('');
  const today = todayIso();
  const nextDays = useMemo(() => nextFollowUpDays(followUps.all), [followUps.all]);
  const all = useMemo(
    () => buildClientRows(view.clients, docs, view.notes, nextDays, view.inquiries),
    [view.clients, docs, view.notes, nextDays, view.inquiries],
  );
  const counts = tabCounts(all);
  const rows = listClientRows(all, { tab, status, range, sort, query, today });
  const canAdd = view.canAdd && !view.company.suspended;
  const statusLabel: Record<ClientStatus, string> = {
    inquiry: s.docInquiry,
    quoted: s.stQuoted,
    unpaid: s.stUnpaid,
    part_paid: s.stPartPaid,
    paid: s.stPaid,
    client: s.stClient,
    rejected: s.inqStRejected,
    lost: s.stLost,
  };
  return (
    <CompanyPage
      groupId={groupId}
      title={s.title}
      actions={
        <span>
          <Link className="btn soft" href={`/c/${groupId}/followups`}>
            {s.fuTitle}
            {followUps.overdue + followUps.dueToday
              ? ` (${followUps.overdue + followUps.dueToday})`
              : ''}
          </Link>{' '}
          {tickets.canAdd ? (
            <Link className="btn soft" href={`/c/${groupId}/tickets`}>
              {s.ticketsLink}
            </Link>
          ) : null}{' '}
          {canAdd ? (
            <Link className="btn brand" href={`/c/${groupId}/clients/new`}>
              {s.addClient}
            </Link>
          ) : null}
        </span>
      }
    >
      {!view.company.ready ? (
        <p className="faint">{t.company.common.loading}</p>
      ) : all.length === 0 ? (
        <EmptyState
          Icon={Users}
          title={s.emptyTitle}
          body={s.emptyBody}
          action={canAdd ? { label: s.addClient, href: `/c/${groupId}/clients/new` } : undefined}
        />
      ) : (
        <>
          <SegmentedTabs
            label={s.title}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'all', label: fill(s.tAll, { n: counts.all }) },
              { value: 'inquiry', label: fill(s.tInquiries, { n: counts.inquiry }) },
              { value: 'quote', label: fill(s.tQuotes, { n: counts.quote }) },
              { value: 'invoice', label: fill(s.tInvoices, { n: counts.invoice }) },
            ]}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            <input
              aria-label={s.search}
              placeholder={s.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label={s.sortLabel}
              value={sort}
              onChange={(e) => setSort(e.target.value as ClientSort)}
            >
              <option value="recent">{s.sortUpdated}</option>
              <option value="amount">{s.sortAmount}</option>
              <option value="name">{s.sortName}</option>
            </select>
            <select
              aria-label={s.fStatus}
              value={status ?? ''}
              onChange={(e) => setStatus((e.target.value || null) as ClientStatus | null)}
            >
              <option value="">{`${s.fStatus}: ${s.fAll}`}</option>
              {STATUSES.map((st) => (
                <option key={st} value={st}>
                  {statusLabel[st]}
                </option>
              ))}
            </select>
            <select
              aria-label={s.fDate}
              value={range}
              onChange={(e) => setRange(e.target.value as DateRange)}
            >
              <option value="all">{s.rAll}</option>
              <option value="month">{s.rMonth}</option>
              <option value="quarter">{s.rQuarter}</option>
            </select>
          </div>
          {rows.length === 0 ? (
            <p className="faint">{s.noMatches}</p>
          ) : (
            <div className="list">
              {rows.map((r) => (
                <Link
                  key={r.client.id}
                  className="item"
                  href={`/c/${groupId}/clients/${r.client.id}`}
                >
                  <span className="grow">
                    <strong>{r.client.name}</strong>
                    <br />
                    <span className="faint">
                      {r.nextFollowUp
                        ? `${s.followUp} ${r.nextFollowUp}`
                        : r.latest
                          ? r.latest.type === 'bill'
                            ? s.docInvoice
                            : s.docQuote
                          : s.docInquiry}
                    </span>
                  </span>
                  <span>{statusLabel[r.status]}</span>{' '}
                  <span>
                    {r.amountMinor == null
                      ? '—'
                      : money(r.amountMinor, view.company.currency, locale)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </CompanyPage>
  );
}
