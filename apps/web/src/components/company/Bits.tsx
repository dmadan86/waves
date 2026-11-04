'use client';

import { useCallback, useState, type ReactNode } from 'react';
import Link from 'next/link';

import { parseMinorInput, type CompanyEntry, type CurrencyCode } from '@waves/core';

import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { kindLabel } from '@/lib/company/labels';
import { memberName, type CompanyView } from '@/lib/company/view';
import { money } from '@/lib/money';

/** The page body wrapper every company page uses. */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{title}</h1>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Run a write, remember the failure as a sentence for the page. */
export function useAction(where: string) {
  const { t } = useStrings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (work: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await work();
        return true;
      } catch (caught) {
        setError(
          friendlyError(caught, where, {
            fallback: t.company.common.couldNotSave,
            offline: t.errors.offline,
          }),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [where, t.company.common.couldNotSave, t.errors.offline],
  );
  return { busy, error, run, clear: () => setError(null) };
}

export function useMoney(currency: string): (minor: bigint) => string {
  const { locale } = useStrings();
  return (minor) => money(minor, currency, locale);
}

/** One entry as a list row: who, what, when, how much. */
export function EntryRow({
  view,
  entry,
  groupId,
  extra,
}: {
  view: CompanyView;
  entry: CompanyEntry;
  groupId: string;
  extra?: ReactNode;
}) {
  const { t } = useStrings();
  const fmt = useMoney(view.currency);
  const who = entry.paidByCompany
    ? view.name
    : memberName(
        view.members.find((m) => m.id === entry.memberId),
        t.company.common.someone,
      );
  const status = entry.status === 'submitted' ? ` · ${t.company.status.submitted}` : '';
  return (
    <div className="item">
      <Link href={`/c/${groupId}/entry/${entry.id}`} className="grow">
        <span className="title">
          {who} · {kindLabel(t.company, view, entry)}
        </span>
        <span className="meta">
          {entry.occurredOn}
          {status}
          {entry.note ? ` · ${entry.note}` : ''}
        </span>
      </Link>
      <span>{fmt(entry.amount)}</span>
      {extra}
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

/** "12.50" to minor units in the company's currency; 0n for anything unreadable. */
export function toMinor(text: string, currency: string): bigint {
  try {
    return parseMinorInput(text, currency as CurrencyCode);
  } catch {
    return 0n;
  }
}
