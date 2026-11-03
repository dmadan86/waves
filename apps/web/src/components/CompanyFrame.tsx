'use client';

/**
 * The frame every company page sits in: the app shell plus the company's own bar
 * (Overview · Payments · Team · Budgets · Pending · More), mirroring the phone.
 * Employees get no bar; they have one screen. Later slices link in through
 * `/more`, so the bar itself stays at six entries.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { useCompanyView } from '@/lib/company/view';

export function CompanyFrame({ groupId, children }: { groupId: string; children: ReactNode }) {
  return (
    <AppFrame current={Section.Companies}>
      {() => <Inner groupId={groupId}>{children}</Inner>}
    </AppFrame>
  );
}

function Inner({ groupId, children }: { groupId: string; children: ReactNode }) {
  const { t } = useStrings();
  const view = useCompanyView(groupId);
  const pathname = usePathname();
  const base = `/c/${groupId}`;

  if (!view.ready) {
    return (
      <div className="app-body">
        <div className="app-main">
          <p className="faint">{t.company.common.loading}</p>
        </div>
      </div>
    );
  }

  const bar = [
    { href: base, label: t.company.nav.overview },
    { href: `${base}/payments`, label: t.company.nav.payments },
    { href: `${base}/team`, label: t.company.nav.team },
    { href: `${base}/budgets`, label: t.company.nav.budgets, ownerOnly: true },
    { href: `${base}/pending`, label: t.company.nav.pending },
    { href: `${base}/more`, label: t.company.nav.more },
  ].filter((item) => !item.ownerOnly || view.isOwner);

  return (
    <>
      {view.isAdmin ? (
        <nav className="tabs" aria-label={t.company.nav.label} style={{ margin: '12px 16px 0' }}>
          {bar.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="tab"
              aria-selected={pathname === item.href}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {children}
    </>
  );
}
