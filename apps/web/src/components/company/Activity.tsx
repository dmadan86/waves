'use client';

import Link from 'next/link';

import { fill } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { webHref, type CompanyActivityEvent } from '@/lib/company/activity';
import { money } from '@/lib/money';

/** The sentence for one event, in the reader's language. */
export function activityText(a: Record<string, string>, event: CompanyActivityEvent): string {
  const template = a[event.text] ?? event.text;
  const vars: Record<string, string | number> = { ...event.vars };
  // `status` arrives as a key (present/half/absent); say it in words.
  if (typeof vars.status === 'string') {
    const key = `status${vars.status.charAt(0).toUpperCase()}${vars.status.slice(1)}`;
    vars.status = a[key] ?? vars.status;
  }
  return fill(template, vars);
}

export function ActivityRows({
  groupId,
  events,
}: {
  groupId: string;
  events: readonly CompanyActivityEvent[];
}) {
  const { t, locale } = useStrings();
  return (
    <>
      {events.map((event) => (
        <Link key={event.id} href={webHref(groupId, event.href)} className="item">
          <span className="grow">
            <span className="title">{activityText(t.company.activity, event)}</span>
            <span className="meta">{new Date(event.at).toLocaleString(locale)}</span>
          </span>
          {event.amount ? (
            <span>{money(event.amount.minor, event.amount.currency, locale)}</span>
          ) : null}
        </Link>
      ))}
    </>
  );
}
