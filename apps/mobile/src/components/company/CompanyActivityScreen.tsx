/** The company's own activity feed: a timeline of cards, searchable and filterable, each opening its screen. */

import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, TextInput, View } from 'react-native';

import { Button, Sheet, Text, useTheme } from '@waves/ui';

import { ActivityCards, useActivityText } from '@/components/company/CompanyActivityFeed';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { IconButton } from '@/components/company/dashboard/parts';
import { useCompanyActivity } from '@/data/companyActivity';
import { useCompanyEntries } from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';
import { ACTIVITY_WINDOW_DAYS, type ActivityGroup } from '@/lib/companyActivity';
import { markCompanyActivitySeen } from '@/lib/companyActivitySeen';

type Filter = 'all' | ActivityGroup;

export function CompanyActivityScreen({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const a = t.companyActivity;
  const theme = useTheme();
  const view = useCompanyEntries(groupId);
  const [days, setDays] = useState(ACTIVITY_WINDOW_DAYS);
  const { events, ready } = useCompanyActivity(groupId, days);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const text = useActivityText();

  // Opening the feed is the look that clears the bell's dot.
  useEffect(() => {
    if (ready) markCompanyActivitySeen(groupId, Date.now());
  }, [groupId, ready]);

  const present = useMemo(() => new Set(events.map((e) => e.group)), [events]);
  const options = (
    [
      { value: 'all', label: a.all },
      { value: 'money', label: a.money },
      { value: 'attendance', label: a.attendance },
      { value: 'tasks', label: a.tasks },
      { value: 'people', label: a.people },
      { value: 'vendors', label: a.vendors },
    ] as const
  ).filter((o) => o.value === 'all' || present.has(o.value));
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      events.filter(
        (e) =>
          (filter === 'all' || e.group === filter) &&
          (!q ||
            `${fill(a.heads[e.text], e.vars)} ${text(e)} ${e.amount ? Number(e.amount.minor) / 100 : ''}`
              .toLowerCase()
              .includes(q)),
      ),
    // text/a change with the locale only; events, filter and q drive the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, filter, q],
  );

  return (
    <SectionShell
      groupId={groupId}
      view={view}
      actions={
        <>
          <IconButton
            round
            icon="search-outline"
            label={a.searchActivity}
            onPress={() => setSearching((s) => !s)}
          />
          <IconButton
            round
            icon="options-outline"
            label={a.filter}
            onPress={() => setFiltering(true)}
          />
        </>
      }
    >
      <>
        <View style={{ gap: 2 }}>
          <Text variant="title">{t.company.recentTitle}</Text>
          <Text variant="caption" tone="muted">
            {a.subtitle}
          </Text>
        </View>
        {searching ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={a.searchActivity}
            placeholder={a.searchActivity}
            placeholderTextColor={theme.color.textFaint}
            returnKeyType="search"
            style={{
              borderWidth: 1,
              borderColor: theme.color.border,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: Platform.OS === 'ios' ? theme.spacing.md : theme.spacing.sm,
              fontSize: 16,
              color: theme.color.text,
              textAlign: 'auto',
            }}
          />
        ) : null}
        {ready && shown.length === 0 ? (
          <Text variant="caption" tone="muted">
            {a.empty}
          </Text>
        ) : null}
        <ActivityCards groupId={groupId} events={shown} currency={view.currency} />
        {ready ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={a.showOlder}
            onPress={() => setDays((d) => d + ACTIVITY_WINDOW_DAYS)}
            style={{
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.spacing.xl,
              paddingVertical: theme.spacing.md,
              borderRadius: 999,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Text style={{ fontWeight: '700', color: theme.color.brand }}>{a.showOlder}</Text>
            <Ionicons name="chevron-down" size={16} color={theme.color.brand} />
          </Pressable>
        ) : null}
        <Sheet
          visible={filtering}
          onClose={() => setFiltering(false)}
          closeLabel={t.common.close}
          title={a.filter}
        >
          <View style={{ gap: theme.spacing.sm }}>
            {options.map((o) => (
              <Button
                key={o.value}
                variant={filter === o.value ? 'primary' : 'secondary'}
                label={o.label}
                accessibilityLabel={o.label}
                onPress={() => {
                  setFilter(o.value);
                  setFiltering(false);
                }}
              />
            ))}
          </View>
        </Sheet>
      </>
    </SectionShell>
  );
}
