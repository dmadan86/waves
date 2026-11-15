'use client';

/** The plain page shell the company data pages share: frame, heading, one panel column. */

import type { ReactNode } from 'react';
import Link from 'next/link';

import { CompanyFrame } from '@/components/CompanyFrame';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';

export function CompanyPage({
  groupId,
  title,
  back,
  actions,
  children,
}: {
  groupId: string;
  title: string;
  /** Where "Back" goes, when this is not a top-level page. */
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useStrings();
  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            {back ? (
              <Link className="btn soft" href={back}>
                {t.company.common.back}
              </Link>
            ) : null}
            <h1>{title}</h1>
            {actions}
          </div>
          {children}
        </div>
      </div>
    </CompanyFrame>
  );
}

/** Money for this page's currency and locale, and a readable error for a failed write. */
export function useCompanyText(currency: string) {
  const { t, locale } = useStrings();
  return {
    t,
    locale,
    fmt: (minor: bigint) => money(minor, currency, locale),
    err: (caught: unknown, where: string) =>
      friendlyError(caught, `web.company.${where}`, {
        fallback: t.errors.couldNotSave,
        offline: t.errors.offline,
      }),
  };
}
