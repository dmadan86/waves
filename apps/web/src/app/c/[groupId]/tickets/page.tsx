'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { Suspense } from 'react';

import { filterTickets, ticketCounts, type TicketTab } from '@waves/core';

import { EmptyState } from '@/components/EmptyState';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { CompanyPage } from '@/lib/company/ClientParts';
import { useNow, useTicketText } from '@/lib/company/TicketParts';
import { ticketNumber } from '@waves/core';
import { useCompanyTickets } from '@/lib/company/useClients';
import { useCompanyView } from '@/lib/company/view';

export default function TicketsPage() {
  return (
    <Suspense fallback={null}>
      <List />
    </Suspense>
  );
}

function List() {
  const { groupId } = useParams<{ groupId: string }>();
  const clientId = useSearchParams().get('clientId') ?? undefined;
  const { t } = useStrings();
  const s = t.company.clients.tk;
  const view = useCompanyTickets(groupId);
  const co = useCompanyView(groupId);
  const text = useTicketText();
  const now = useNow();
  const [tab, setTab] = useState<TicketTab>('open');
  const scoped = clientId ? view.tickets.filter((x) => x.clientId === clientId) : view.tickets;
  const counts = ticketCounts(scoped, now);
  const rows = filterTickets(scoped, tab, now);
  const canAdd = view.canAdd && !co.suspended;
  const addHref = `/c/${groupId}/tickets/new${clientId ? `?clientId=${clientId}` : ''}`;
  return (
    <CompanyPage
      groupId={groupId}
      title={s.title}
      back={{ href: `/c/${groupId}/clients`, label: t.company.common.back }}
      actions={
        canAdd ? (
          <Link className="btn brand" href={addHref}>
            {s.newComplaint}
          </Link>
        ) : undefined
      }
    >
      {!co.ready ? (
        <p className="faint">{t.company.common.loading}</p>
      ) : scoped.length === 0 ? (
        <EmptyState
          Icon={MessageSquare}
          title={s.emptyTitle}
          body={s.emptyBody}
          action={canAdd ? { label: s.newComplaint, href: addHref } : undefined}
        />
      ) : (
        <>
          <SegmentedTabs
            label={s.title}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'open', label: fill(s.tOpen, { n: counts.open }) },
              { value: 'escalated', label: fill(s.tEscalated, { n: counts.escalated }) },
              { value: 'resolved', label: fill(s.tResolved, { n: counts.resolved }) },
            ]}
          />
          {rows.length === 0 ? (
            <p className="faint">{s.emptyTab}</p>
          ) : (
            <div className="list">
              {rows.map((tk) => (
                <Link key={tk.id} className="item" href={`/c/${groupId}/tickets/${tk.id}`}>
                  <span className="grow">
                    <strong>{tk.clientName || tk.title}</strong>
                    <br />
                    <span className="faint">
                      {tk.title} · {tk.number > 0 ? ticketNumber(tk.number) : ''} ·{' '}
                      {view.memberName(tk.assigneeMemberId) || s.someone}
                    </span>
                  </span>
                  <span>{text.priority(tk.priority)}</span>{' '}
                  <span>{text.due(tk, now, view).text}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </CompanyPage>
  );
}
