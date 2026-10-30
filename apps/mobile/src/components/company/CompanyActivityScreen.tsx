/** The company's own activity feed: what happened, by day, filterable, each row opening its screen. */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { ActivityRows } from '@/components/company/CompanyActivityFeed';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyActivity } from '@/data/companyActivity';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { groupByDay, localDay, type ActivityGroup } from '@/lib/companyActivity';
import { markCompanyActivitySeen } from '@/lib/companyActivitySeen';
import { showDate } from '@/lib/expenseDay';

type Filter = 'all' | ActivityGroup;

export function CompanyActivityScreen({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();
  const a = t.companyActivity;
  const theme = useTheme();
  const view = useCompanyEntries(groupId);
  const { events, ready } = useCompanyActivity(groupId);
  const [filter, setFilter] = useState<Filter>('all');

  // Opening the feed is the look that clears the bell's dot.
  useEffect(() => {
    if (ready) markCompanyActivitySeen(groupId, Date.now());
  }, [groupId, ready]);

  const present = useMemo(() => new Set(events.map((e) => e.group)), [events]);
  const options = useMemo(
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
  const shown = useMemo(
    () => groupByDay(filter === 'all' ? events : events.filter((e) => e.group === filter)),
    [events, filter],
  );
  const today = todayIso();
  const yesterday = localDay(new Date(`${today}T12:00:00`).getTime() - 24 * 60 * 60 * 1000);
  const dayLabel = (day: string): string =>
    day === today ? a.today : day === yesterday ? a.yesterday : showDate(day, locale);

  return (
    <SectionShell groupId={groupId} view={view}>
      <>
        <Text variant="title">{a.title}</Text>
        {options.length > 2 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <SegmentedPills options={options} value={filter} onChange={setFilter} />
            </View>
          </ScrollView>
        ) : null}
        {ready && shown.length === 0 ? (
          <Text variant="caption" tone="muted">
            {a.empty}
          </Text>
        ) : null}
        {shown.map((d) => (
          <View key={d.day} style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {dayLabel(d.day)}
            </Text>
            <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              <ActivityRows groupId={groupId} events={d.events} currency={view.currency} />
            </StandardCard>
          </View>
        ))}
      </>
    </SectionShell>
  );
}
