'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { CompanyFrame } from '@/components/CompanyFrame';
import { ActivityRows } from '@/components/company/Activity';
import { Page } from '@/components/company/Bits';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { useStrings } from '@/i18n-context';
import { groupByDay, localDay, type ActivityGroup } from '@/lib/company/activity';
import { useCompanyActivity } from '@/lib/company/activityHook';
import { todayIso } from '@/lib/company/view';

type Filter = 'all' | ActivityGroup;

export default function CompanyActivityPage() {
  const { groupId } = useParams<{ groupId: string }>();
  return (
    <CompanyFrame groupId={groupId}>
      <Feed groupId={groupId} />
    </CompanyFrame>
  );
}

function Feed({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();
  const a = t.company.activity;
  const { events, ready } = useCompanyActivity(groupId);
  const [filter, setFilter] = useState<Filter>('all');
  const present = useMemo(() => new Set(events.map((e) => e.group)), [events]);
  const tabs = useMemo(
    () =>
      (
        [
          { value: 'all', label: a.all },
          { value: 'money', label: a.money },
          { value: 'attendance', label: a.attendance },
          { value: 'tasks', label: a.tasks },
          { value: 'people', label: a.people },
          { value: 'vendors', label: a.vendors },
        ] as const
      ).filter((o) => o.value === 'all' || present.has(o.value)),
    [a, present],
  );
  // A filter whose events have gone falls back to all.
  const current: Filter = filter === 'all' || present.has(filter) ? filter : 'all';
  const shown = useMemo(
    () => groupByDay(current === 'all' ? events : events.filter((e) => e.group === current)),
    [events, current],
  );
  const today = todayIso();
  const yesterday = localDay(new Date(`${today}T12:00:00`).getTime() - 24 * 60 * 60 * 1000);
  const label = (day: string): string =>
    day === today
      ? a.today
      : day === yesterday
        ? a.yesterday
        : new Date(`${day}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'medium' });

  return (
    <Page title={a.title}>
      {tabs.length > 2 ? (
        <SegmentedTabs tabs={tabs} value={current} onChange={setFilter} label={a.title} />
      ) : null}
      {ready && shown.length === 0 ? <p className="faint">{a.empty}</p> : null}
      {shown.map((d) => (
        <section key={d.day} className="panel">
          <h3>{label(d.day)}</h3>
          <ActivityRows groupId={groupId} events={d.events} />
        </section>
      ))}
    </Page>
  );
}
