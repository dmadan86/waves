'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Store } from 'lucide-react';

import {
  filterVendorRows,
  vendorDashboard,
  type VendorFilter,
  type VendorPeriod,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { EmptyState } from '@/components/EmptyState';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { useVendorsData } from '@/lib/company/useVendors';
import { todayIso } from '@/lib/company/vendors';
import { Page, Pill, useVendorFormat } from './_components/parts';
import { VendorHome } from './_components/VendorHome';

const PERIODS: readonly VendorPeriod[] = ['month', 'lastMonth', 'year', 'all'];
const FILTERS: readonly VendorFilter[] = [
  'all',
  'toPay',
  'settled',
  'toReview',
  'overdue',
  'receipts',
];

export default function VendorsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Inner groupId={groupId} />
    </CompanyFrame>
  );
}

function Inner({ groupId }: { groupId: string }) {
  const d = useVendorsData(groupId);
  // A vendor's own login has one screen: their ledger with this company.
  return d.vendors.isVendor ? <VendorHome groupId={groupId} /> : <List groupId={groupId} />;
}

function List({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const s = t.company.vendors;
  const d = useVendorsData(groupId);
  const f = useVendorFormat(d.vendors.currency);
  const [filter, setFilter] = useState<VendorFilter>('all');
  const [period, setPeriod] = useState<VendorPeriod>('month');
  const [query, setQuery] = useState('');
  const dash = useMemo(
    () => vendorDashboard(d.vendors.vendors, d.vendors.lines, todayIso(), period),
    [d.vendors.vendors, d.vendors.lines, period],
  );
  const rows = filterVendorRows(dash.rows, filter, query);
  const periodLabel: Record<VendorPeriod, string> = {
    month: s.periodMonth,
    lastMonth: s.periodLast,
    year: s.periodYear,
    all: s.periodAll,
  };
  const filterLabel: Record<VendorFilter, string> = {
    all: s.allVendors,
    toPay: s.filterToPay,
    settled: s.settled,
    toReview: s.pendingReview,
    overdue: s.statusOverdue,
    receipts: s.receipts,
  };
  return (
    <Page title={s.title}>
      <p>
        {d.canManage ? (
          <>
            <Link className="btn brand" href={`/c/${groupId}/vendors/new`}>
              {s.addVendor}
            </Link>{' '}
          </>
        ) : null}
        <Link className="btn soft" href={`/c/${groupId}/details`}>
          {t.company.vendors.details.title}
        </Link>
      </p>
      <div className="panel">
        <p className="faint">{s.totalToPay}</p>
        <p style={{ fontSize: 24, fontWeight: 800 }}>{f.money(dash.totalToPay)}</p>
        <p>
          <button type="button" className="btn soft" onClick={() => setFilter('toReview')}>
            {dash.billsToReview} {s.pending}
          </button>{' '}
          <button type="button" className="btn soft" onClick={() => setFilter('receipts')}>
            {dash.receipts} {s.receipts}
          </button>{' '}
          <button type="button" className="btn soft" onClick={() => setFilter('settled')}>
            {dash.counts.settled} {s.settled}
          </button>
        </p>
      </div>
      <div className="row-field">
        <select
          aria-label={s.periodMonth}
          value={period}
          onChange={(e) => setPeriod(e.target.value as VendorPeriod)}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {periodLabel[p]}
            </option>
          ))}
        </select>
        <select
          aria-label={s.allVendors}
          value={filter}
          onChange={(e) => setFilter(e.target.value as VendorFilter)}
        >
          {FILTERS.map((x) => (
            <option key={x} value={x}>
              {filterLabel[x]}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label={s.search}
          placeholder={s.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {dash.rows.length === 0 ? (
        <EmptyState Icon={Store} title={s.emptyList} />
      ) : rows.length === 0 ? (
        <p className="faint">{s.noMatch}</p>
      ) : (
        <div className="list">
          {rows.map((row) => {
            const { vendor, balance } = row;
            const extras = [
              row.toReview > 0 ? fill(s.pendingN, { n: String(row.toReview) }) : null,
              row.receipts > 0
                ? fill(row.receipts === 1 ? s.receiptOne : s.receiptMany, {
                    n: String(row.receipts),
                  })
                : null,
            ].filter(Boolean);
            return (
              <Link key={vendor.id} className="item" href={`/c/${groupId}/vendors/${vendor.id}`}>
                <span className="grow">
                  <span className="title">
                    {vendor.name}{' '}
                    {row.overdue > 0n ? <Pill tone="bad">{s.statusOverdue}</Pill> : null}
                  </span>
                  <span className="meta">
                    {[vendor.categories.join(' · '), ...extras].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="title">
                  {f.money(balance < 0n ? -balance : balance)}{' '}
                  <span className="faint">
                    {balance < 0n ? s.advance : balance === 0n ? s.settled : s.filterToPay}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
