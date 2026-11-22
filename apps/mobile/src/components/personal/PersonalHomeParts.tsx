/**
 * The Personal home's smaller sections: the quick-action row, the "Upcoming &
 * Reminders" card (and its row, shared with the full list) and the Money tools
 * row. The ledger-bound cards stay in `(tabs)/me.tsx`.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { pickUpcoming, type PersonalRecurring, type PersonalTxn } from '@waves/core';
import { Card, directionalIcon, iconSize, Row, Text, useTheme, type TintName } from '@waves/ui';

import { useSourceLabel } from '@/components/IncomeSource';
import { useSetupLeft } from '@/components/PersonalSetupCard';
import { useDateOccurrences } from '@/data/personalDates';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { actionFor } from '@/lib/dateReminders/actions';
import { subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { router } from '@/lib/navigation';
import { billRows, dateRows, mergeUpcoming, type UpcomingRow } from '@/lib/personalUpcoming';

/** Bills the card looks ahead for; the full list looks further. */
const HOME_HORIZON_DAYS = 14;
const LIST_HORIZON_DAYS = 60;

/** The merged rows: bills, dates and the setup to-do. `limit` 0 lists them all. */
export function usePersonalUpcoming(
  ledger: {
    txns: readonly PersonalTxn[];
    recurrings: readonly PersonalRecurring[];
    currency: string;
    today: string;
  },
  limit: number,
): UpcomingRow[] {
  const { session, isGuest } = useAuth();
  const occurrences = useDateOccurrences();
  const left = useSetupLeft();
  const dates = session && !isGuest ? pickUpcoming(occurrences, limit > 0 ? limit : 50) : [];
  const bills = billRows(
    ledger.txns,
    ledger.recurrings,
    ledger.currency,
    ledger.today,
    limit > 0 ? HOME_HORIZON_DAYS : LIST_HORIZON_DAYS,
  );
  return mergeUpcoming([...bills, ...dateRows(dates)], left.length, limit);
}

export const ICON_FOR: Record<string, keyof typeof Ionicons.glyphMap> = {
  festival: 'sparkles-outline',
  family_birthday: 'gift-outline',
  my_birthday: 'gift-outline',
  anniversary: 'heart-outline',
  work_anniversary: 'briefcase-outline',
};

export function UpcomingRowView({
  row,
  fmt,
  last,
}: {
  row: UpcomingRow;
  fmt: (amount: bigint, currency: string) => string;
  last: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.personalHome;
  const sourceLabel = useSourceLabel();
  const run = useRunDateAction();
  const left = useSetupLeft();
  const ink = theme.color[row.tone];
  const soft = theme.color[`${row.tone}Soft` as 'brandSoft'];

  const item = row.item;
  const action = item ? actionFor(item) : null;
  const dayName = (iso: string): string => {
    try {
      return dateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${iso}T00:00:00Z`),
      );
    } catch {
      return iso;
    }
  };

  let title: string;
  let subtitle: string;
  let icon: keyof typeof Ionicons.glyphMap;
  let onPress: () => void;
  if (row.kind === 'todo') {
    title = h.todo;
    subtitle = plural(locale, row.left ?? 0, h.itemsLeft);
    icon = 'checkbox-outline';
    onPress = () =>
      router.push({ pathname: '/personal/setup', params: left[0] ? { step: left[0] } : {} });
  } else if (item) {
    title = titleOf(item, t.dates);
    subtitle = subtitleOf(item, t.dates, locale);
    icon = ICON_FOR[item.kind] ?? 'calendar-outline';
    onPress = () =>
      action
        ? run(item)
        : item.source === 'date'
          ? router.push({ pathname: '/dates/edit', params: { id: item.id } })
          : router.push('/dates');
  } else {
    title = row.title || sourceLabel(row.category ?? null) || t.personal.expense;
    subtitle = fill(h.dueOn, { date: dayName(row.date ?? '') });
    icon = 'receipt-outline';
    onPress = () => router.push(`/personal/source/${row.ruleId}`);
  }

  const pill =
    row.kind === 'todo'
      ? null
      : row.inDays < 0
        ? h.overdue
        : row.inDays === 0
          ? h.today
          : plural(locale, row.inDays, h.inDays);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}${pill ? `, ${pill}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 52,
        paddingVertical: theme.spacing.xs,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: ink }} />
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: soft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {row.amount !== undefined && row.currency ? (
        <Text numberOfLines={1} style={{ fontWeight: '700' }}>
          {fmt(row.amount, row.currency)}
        </Text>
      ) : null}
      {pill ? (
        <View
          style={{
            borderRadius: theme.radius.pill,
            backgroundColor: soft,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 2,
          }}
        >
          <Text variant="micro" numberOfLines={1} style={{ color: ink, fontWeight: '700' }}>
            {pill}
          </Text>
        </View>
      ) : (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      )}
    </Pressable>
  );
}

/** A card title with an optional "View all ›" link. */
export function CardTitle({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <Text accessibilityRole="header" variant="subheading" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Text>
      {children}
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${action}, ${title}`}
          onPress={onAction}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
            {action}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.brand}
          />
        </Pressable>
      ) : null}
    </Row>
  );
}

export function PersonalUpcomingCard({
  rows,
  fmt,
}: {
  rows: readonly UpcomingRow[];
  fmt: (amount: bigint, currency: string) => string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
      <CardTitle
        title={t.personalHome.upcomingTitle}
        action={t.personal.dash.viewAll}
        onAction={() => router.push('/personal/upcoming')}
      />
      {rows.length > 0 ? (
        <View>
          {rows.map((row, i) => (
            <UpcomingRowView key={row.key} row={row} fmt={fmt} last={i === rows.length - 1} />
          ))}
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          {t.personalHome.upcomingEmpty}
        </Text>
      )}
    </Card>
  );
}

interface Tile {
  readonly key: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
}

/** Five equal tiles under the hero: the things done most. */
export function QuickActions({
  tiles,
}: {
  tiles: readonly (Tile & { tone: 'brand' | 'positive' })[];
}) {
  const theme = useTheme();
  return (
    <Row style={{ gap: theme.spacing.sm }}>
      {tiles.map((tile) => (
        <Pressable
          key={tile.key}
          accessibilityRole="button"
          accessibilityLabel={tile.label}
          onPress={tile.onPress}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            alignItems: 'center',
            gap: theme.spacing.xs,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: 2,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.color.border,
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: theme.radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                tile.tone === 'positive' ? theme.color.positiveSoft : theme.color.brandSoft,
            }}
          >
            <Ionicons
              name={tile.icon}
              size={iconSize.md}
              color={tile.tone === 'positive' ? theme.color.positive : theme.color.brand}
            />
          </View>
          <Text variant="micro" numberOfLines={2} align="center" style={{ fontWeight: '600' }}>
            {tile.label}
          </Text>
        </Pressable>
      ))}
    </Row>
  );
}

/** The Money tools strip: pastel tiles that scroll sideways. */
export function MoneyToolsRow({ tiles }: { tiles: readonly (Tile & { tint: TintName })[] }) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.spacing.sm }}
    >
      {tiles.map((tile) => {
        const tint = theme.tint[tile.tint];
        return (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            onPress={tile.onPress}
            style={({ pressed }) => ({
              width: 84,
              minHeight: 72,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
              padding: theme.spacing.sm,
              borderRadius: theme.radius.md,
              backgroundColor: tint.bg,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name={tile.icon} size={iconSize.md} color={tint.ink} />
            <Text variant="micro" align="center" numberOfLines={2} style={{ fontWeight: '600' }}>
              {tile.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A lavender strip at the foot of a home: a one-line fact with a door to its details. */
export function PrivacyPill({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const tint = theme.tint.lilac;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.md,
        backgroundColor: tint.bg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="lock-closed" size={iconSize.sm} color={tint.ink} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, color: tint.ink, fontWeight: '600' }}
      >
        {label}
      </Text>
      <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={tint.ink} />
    </Pressable>
  );
}
