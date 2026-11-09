/** Rows of the company activity feed, shared by the full screen and the Overview's latest five. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { SectionCard, useMoney, GREEN, BLUE } from '@/components/company/dashboard/parts';
import { AMBER, IconDisc, RED } from '@/components/company/dashboard/overviewKit';
import { ListRow } from '@/components/standard';
import { useCompanyActivity } from '@/data/companyActivity';
import { useCompanyEntries } from '@/data/companyEntries';
import { fill, useStrings } from '@/i18n';
import type { ActivityGroup, CompanyActivityEvent } from '@/lib/companyActivity';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';

const VIOLET = '#7C3AED';

export function useActivityText(): (e: CompanyActivityEvent) => string {
  const { t } = useStrings();
  const a = t.companyActivity;
  return (e) => {
    const status = e.vars.status;
    const word =
      status === 'present'
        ? a.statusPresent
        : status === 'half'
          ? a.statusHalf
          : status === 'absent'
            ? a.statusAbsent
            : undefined;
    return fill(a[e.text], word ? { ...e.vars, status: word } : e.vars);
  };
}

export function ActivityRows({
  groupId,
  events,
  currency,
}: {
  groupId: string;
  events: readonly CompanyActivityEvent[];
  currency: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const text = useActivityText();
  const fmt = useMoney(currency);
  const ink: Record<ActivityGroup, string> = {
    money: theme.color.brand,
    attendance: GREEN,
    tasks: AMBER,
    people: BLUE,
    vendors: VIOLET,
  };
  const time = dateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  return (
    <>
      {events.map((e, i) => {
        // Absent is the one attendance mark that reads as bad news: red, like the mockup.
        const color = e.group === 'attendance' && e.vars.status === 'absent' ? RED : ink[e.group];
        const title = fill(t.companyActivity.heads[e.text], e.vars);
        const amount = e.amount ? fmt(e.amount.minor) : undefined;
        const open = () => router.push(`/group/${groupId}/${e.href}`);
        return (
          <ListRow
            key={e.id}
            leading={
              <IconDisc ink={color} size={36}>
                <Ionicons name={e.icon} size={iconSize.md} color={color} />
              </IconDisc>
            }
            title={title}
            accessibilityLabel={[title, text(e), amount].filter(Boolean).join(', ')}
            subtitle={text(e)}
            subtitleLines={2}
            footer={
              amount ? (
                <Text tabular style={{ fontWeight: '700' }}>
                  {amount}
                </Text>
              ) : undefined
            }
            trailing={
              // Same tap as the row; hidden from screen readers, which already have the row.
              <Pressable
                onPress={open}
                hitSlop={8}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}
              >
                <Text variant="micro" tone="muted">
                  {time.format(e.at)}
                </Text>
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={iconSize.sm}
                  color={theme.color.textFaint}
                />
              </Pressable>
            }
            onPress={open}
            divider={i < events.length - 1}
          />
        );
      })}
    </>
  );
}

/** The Overview's "Recent activity": the latest five company events, "See all" opens the whole feed. */
export function RecentCompanyActivity({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const { events, ready } = useCompanyActivity(groupId);
  const latest = events.slice(0, 3);
  return (
    <SectionCard
      title={t.company.recentTitle}
      onViewAll={
        events.length > 0 ? () => router.push(`/group/${groupId}/company-activity`) : undefined
      }
    >
      {latest.length > 0 ? (
        <ActivityRows groupId={groupId} events={latest} currency={view.currency} />
      ) : ready ? (
        <Text variant="caption" tone="muted">
          {t.company.recentNone}
        </Text>
      ) : null}
    </SectionCard>
  );
}
