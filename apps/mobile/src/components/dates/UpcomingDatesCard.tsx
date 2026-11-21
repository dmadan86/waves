/** The Upcoming card (A4): date tiles, what is coming, one action each. Home and Personal home. */

import { Pressable, View } from 'react-native';
import { pickUpcoming, type UpcomingItem } from '@waves/core';
import { Row, Text, useTheme } from '@waves/ui';

import { SectionHeader, StandardCard } from '@/components/standard';
import { useDateOccurrences } from '@/data/personalDates';
import { useStrings } from '@/i18n';
import { actionFor } from '@/lib/dateReminders/actions';
import { actionLabel, subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { useAuth } from '@/lib/auth';
import { router } from '@/lib/navigation';

function useTone(item: UpcomingItem): { bg: string; fg: string } {
  const c = useTheme().color;
  if (item.source === 'festival') return { bg: c.positiveSoft, fg: c.positive };
  if (item.kind === 'family_birthday' || item.kind === 'my_birthday')
    return { bg: c.negativeSoft, fg: c.negative };
  if (item.kind === 'work_anniversary') return { bg: c.warningSoft, fg: c.warning };
  return { bg: c.brandSoft, fg: c.brand };
}

function DateRow({ item, last }: { item: UpcomingItem; last: boolean }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const run = useRunDateAction();
  const tone = useTone(item);
  const action = actionFor(item);
  const at = new Date(`${item.date}T12:00:00`);
  const edit = (): void => {
    if (item.source === 'date') router.push({ pathname: '/dates/edit', params: { id: item.id } });
  };
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={titleOf(item, t.dates)}
        onPress={edit}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          minWidth: 0,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            backgroundColor: tone.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: tone.fg, fontSize: 17, lineHeight: 20, fontWeight: '800' }}>
            {at.getDate()}
          </Text>
          <Text style={{ color: tone.fg, fontSize: 10, lineHeight: 12, fontWeight: '700' }}>
            {at.toLocaleDateString(locale, { month: 'short' }).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {titleOf(item, t.dates)}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitleOf(item, t.dates, locale)}
          </Text>
        </View>
      </Pressable>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel(action, t.dates)}
          onPress={() => run(item)}
          hitSlop={6}
          style={{
            paddingHorizontal: theme.spacing.md,
            height: 32,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.brandSoft,
            justifyContent: 'center',
          }}
        >
          <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
            {actionLabel(action, t.dates)}
          </Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

export function UpcomingDatesCard() {
  const { t } = useStrings();
  const theme = useTheme();
  const { session, isGuest } = useAuth();
  const occurrences = useDateOccurrences();
  if (!session || isGuest) return null;
  const items = pickUpcoming(occurrences);
  const add = (): void => router.push('/dates/edit');
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader title={t.dates.upcoming} action={{ label: t.dates.addDate, onPress: add }} />
      <StandardCard>
        {items.length ? (
          items.map((item, i) => (
            <DateRow key={item.key} item={item} last={i === items.length - 1} />
          ))
        ) : (
          <Text variant="caption" tone="muted">
            {t.dates.empty}
          </Text>
        )}
      </StandardCard>
    </View>
  );
}
