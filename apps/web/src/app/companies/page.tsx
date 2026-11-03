'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';

import { materialiseLedgerGroups, rowsFor, SyncTable } from '@waves/core';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { NO_QUEUE, useSync } from '@/lib/sync';

export default function CompaniesPage() {
  return (
    <AppFrame current={Section.Companies}>{({ query }) => <Companies query={query} />}</AppFrame>
  );
}

function Companies({ query }: { query: string }) {
  const { t } = useStrings();
  const c = t.company.list;
  const { mirror, hydrated } = useSync();

  const companies = useMemo(() => {
    const members = rowsFor(mirror, SyncTable.GroupMembers) as unknown as {
      group_id: string;
      role?: string;
      left_at: string | null;
    }[];
    return materialiseLedgerGroups(mirror, NO_QUEUE)
      .filter((g) => (g as { type?: string }).type === 'company')
      .map((g) => {
        const live = members.filter((m) => m.group_id === g.id && !m.left_at);
        const count = (role: string) => live.filter((m) => m.role === role).length;
        return { id: g.id, name: g.name?.trim() || c.title, owners: count('admin'), managers: count('manager'), employees: count('member') };
      });
  }, [mirror, c.title]);

  const q = query.trim().toLowerCase();
  const shown = q ? companies.filter((x) => x.name.toLowerCase().includes(q)) : companies;

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{c.title}</h1>
          <Link className="btn" href="/companies/new">
            {c.create}
          </Link>
        </div>
        <section className="panel">
          {!hydrated ? (
            <SkeletonRows rows={4} />
          ) : shown.length === 0 ? (
            <EmptyState
              Icon={Building2}
              title={c.empty}
              body={c.emptyBody}
              action={{ label: c.create, href: '/companies/new' }}
            />
          ) : (
            shown.map((x) => (
              <Link key={x.id} href={`/c/${x.id}`} className="item">
                <span className="grow">
                  <span className="title">{x.name}</span>
                  <span className="meta">
                    {fill(c.employees, { n: x.employees })} · {fill(c.managers, { n: x.managers })} ·{' '}
                    {fill(c.owners, { n: x.owners })}
                  </span>
                </span>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
