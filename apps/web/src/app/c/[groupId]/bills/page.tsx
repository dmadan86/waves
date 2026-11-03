'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Receipt } from 'lucide-react';

import { billDueMinor, docNumberLabel } from '@waves/core';

import { CompanyPage, useCompanyText } from '@/components/CompanyPage';
import { EmptyState } from '@/components/EmptyState';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { SkeletonRows } from '@/components/Skeleton';
import { fill } from '@/i18n';
import { docStats, filterDocs, type DocFilter } from '@/lib/company/documents';
import { useCompanyDocs } from '@/lib/company/useCompanyDocs';

export default function CompanyBillsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const view = useCompanyDocs(groupId);
  const { t, locale, fmt } = useCompanyText(view.currency);
  const c = t.company.docs;
  const [filter, setFilter] = useState<DocFilter>('all');
  const [query, setQuery] = useState('');

  const docs = filterDocs(view.docs, filter, query, (d) => docNumberLabel(d.docType, d.number));
  const stats = docStats(view.docs);
  const base = `/c/${groupId}/bills`;

  return (
    <CompanyPage
      groupId={groupId}
      title={c.title}
      actions={
        view.canUse && !view.suspended ? (
          <>
            <Link className="btn brand" href={`${base}/new?type=bill`}>
              {c.newBill}
            </Link>
            <Link className="btn soft" href={`${base}/new?type=estimate`}>
              {c.newEstimate}
            </Link>
          </>
        ) : null
      }
    >
      {!view.ready ? (
        <SkeletonRows rows={4} />
      ) : !view.canUse ? (
        <p className="muted">{c.noAccess}</p>
      ) : (
        <>
          <section className="panel">
            <p>
              {c.total}: <b>{fmt(stats.total)}</b> ({fill(c.docsCount, { n: String(stats.count) })})
            </p>
            <p>
              {c.unpaid}: <b>{fmt(stats.unpaidMinor)}</b> (
              {fill(c.billsCount, { n: String(stats.unpaidCount) })})
            </p>
            <p>
              {c.paid}: <b>{fmt(stats.paidMinor)}</b> (
              {fill(c.billsCount, { n: String(stats.paidCount) })})
            </p>
          </section>
          <SegmentedTabs<DocFilter>
            label={c.title}
            value={filter}
            onChange={setFilter}
            tabs={[
              { value: 'all', label: c.all },
              { value: 'estimate', label: c.estimates },
              { value: 'bill', label: c.bills },
              { value: 'unpaid', label: c.unpaid },
            ]}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.searchPlaceholder}
            aria-label={c.searchLabel}
          />
          {docs.length === 0 ? (
            stats.count > 0 ? (
              <p className="muted">{c.noMatch}</p>
            ) : (
              <EmptyState Icon={Receipt} title={c.noDocsTitle} body={c.noDocsBody} />
            )
          ) : (
            <section className="panel list">
              {docs.map((d) => (
                <Link key={d.id} className="row" href={`${base}/${d.id}`}>
                  <span>
                    <b>
                      {docNumberLabel(d.docType, d.number)} · {d.customerName}
                    </b>
                    <br />
                    <span className="faint">
                      {new Date(`${d.docDate}T00:00:00`).toLocaleDateString(locale)}
                      {d.number === null ? ` · ${c.syncing}` : ''} · {c[d.status]}
                      {d.status === 'part_paid'
                        ? ` · ${c.amountLeft}: ${fmt(billDueMinor(d.totalMinor, d.paidMinor))}`
                        : ''}
                    </span>
                  </span>
                  <span className="row-right">{fmt(d.totalMinor)}</span>
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </CompanyPage>
  );
}
