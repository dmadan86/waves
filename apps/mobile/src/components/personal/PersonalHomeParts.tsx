/**
 * The Personal home's smaller sections: the quick-action row, the "Upcoming &
 * Reminders" card (and its row, shared with the full list) and the Money tools
 * row. The ledger-bound cards stay in `(tabs)/me.tsx`.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, type RefObject } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { pickUpcoming, type PersonalRecurring, type PersonalTxn } from '@waves/core';
import { Card, directionalIcon, iconSize, Row, Text, useTheme, type TintName } from '@waves/ui';

import { useSourceLabel } from '@/components/IncomeSource';
import { GroupRow } from '@/components/home/GroupRow';
import { RaiseCard, useRaisePrompts } from '@/components/wealth/RaiseCard';
import { useDateOccurrences } from '@/data/personalDates';
import { usePersonalWealth } from '@/data/personalWealth';
import { fill, plural, useStrings } from '@/i18n';
import { usePersonalVehicles } from '@/data/vehicles';
import { PressableScale } from '@/lib/anim';
import { dueText } from '@/lib/vehicleText';
import { regionOf } from '@/lib/wealthPlan';
import { badgeLabel } from '@/lib/countBadge';
import { useAuth } from '@/lib/auth';
import { actionFor } from '@/lib/dateReminders/actions';
import { subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';
import {
  billRows,
  dateRows,
  mergeUpcoming,
  vehicleRows,
  wealthRows,
  type UpcomingRow,
} from '@/lib/personalUpcoming';
import { nextDateLabel } from '@/lib/recurringList';

/** Bills the card looks ahead for; the full list looks further. */
const HOME_HORIZON_DAYS = 14;
const LIST_HORIZON_DAYS = 60;

/** Rent, lease-end and maturity rows from the wealth records. */
export function useWealthRows(
  ledger: { txns: readonly PersonalTxn[]; recurrings: readonly PersonalRecurring[]; today: string },
  horizonDays: number,
): UpcomingRow[] {
  const wealth = usePersonalWealth();
  const raises = useRaisePrompts(ledger.today);
  const { t } = useStrings();
  return wealthRows({
    ...wealth,
    txns: ledger.txns,
    recurrings: ledger.recurrings,
    today: ledger.today,
    horizonDays,
    raises,
    titles: {
      rent: (name) => fill(t.wealth.rentRowTitle, { name }),
      lease: (name) => fill(t.wealth.leaseRowTitle, { name }),
      maturity: (name) => fill(t.wealth.maturityRowTitle, { name }),
    },
  });
}

/** Vehicle renewals and licence expiry inside their reminder window. */
function useVehicleRows(today: string): UpcomingRow[] {
  const { vehicles, licences } = usePersonalVehicles();
  const { t } = useStrings();
  const { profile } = useAuth();
  const region = regionOf(profile?.country_code);
  return vehicleRows({
    vehicles,
    licences,
    today,
    title: (name, item) => `${name} · ${dueText(t.vehicles, item, region)}`,
  });
}

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
  const dates = session && !isGuest ? pickUpcoming(occurrences, limit > 0 ? limit : 50) : [];
  const wealth = useWealthRows(ledger, limit > 0 ? HOME_HORIZON_DAYS : LIST_HORIZON_DAYS);
  const vehicles = useVehicleRows(ledger.today);
  const bills = billRows(
    ledger.txns,
    ledger.recurrings,
    ledger.currency,
    ledger.today,
    limit > 0 ? HOME_HORIZON_DAYS : LIST_HORIZON_DAYS,
  );
  return mergeUpcoming([...bills, ...wealth, ...vehicles, ...dateRows(dates)], limit);
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

  if (row.raise) return <RaiseCard prompt={row.raise} />;

  const item = row.item;
  const action = item ? actionFor(item) : null;

  let title: string;
  let subtitle: string;
  let icon: keyof typeof Ionicons.glyphMap;
  let onPress: () => void;
  if (item) {
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
    subtitle = `${row.income ? h.expected : h.due} ${nextDateLabel(row.date ?? '', locale)}`;
    icon = row.income ? 'arrow-down-outline' : 'receipt-outline';
    onPress = () => router.push(row.href ?? `/personal/source/${row.ruleId}`);
  }

  const pill =
    row.inDays < 0 ? h.overdue : row.inDays === 0 ? h.today : plural(locale, row.inDays, h.inDays);

  return (
    <GroupRow
      title={title}
      memberLabel={subtitle}
      amountText={row.amount !== undefined && row.currency ? fmt(row.amount, row.currency) : ''}
      chevron
      directionLabel={pill}
      directionTone={row.inDays < 0 ? 'negative' : 'muted'}
      locale={locale}
      divider={!last}
      icon={icon}
      iconColor={row.inDays < 0 ? theme.color.negative : theme.color.brand}
      tone={row.inDays < 0 ? 'negative' : undefined}
      onPress={onPress}
    />
  );
}

/** A card title with an optional "View all ›" link. */
export function CardTitle({
  title,
  action,
  onAction,
  count,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  /** Pill right after the title; hidden at 0, capped at 99+. */
  count?: number;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const badge = badgeLabel(count);
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <Row
        accessible={badge !== null}
        accessibilityRole={badge !== null ? 'header' : undefined}
        accessibilityLabel={badge !== null ? `${title}, ${count} items` : undefined}
        style={{ flex: 1, alignItems: 'center', gap: theme.spacing.sm }}
      >
        <Text
          accessibilityRole={badge === null ? 'header' : undefined}
          variant="subheading"
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {title}
        </Text>
        {badge !== null ? (
          <View
            style={{
              minWidth: 22,
              height: 22,
              paddingHorizontal: 7,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.negativeSoft,
            }}
          >
            <Text
              variant="caption"
              style={{ fontSize: 12, fontWeight: '700', color: theme.color.negativeText }}
            >
              {badge}
            </Text>
          </View>
        ) : null}
      </Row>
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
        action={t.homeToday.seeAll}
        onAction={() => router.push('/personal/upcoming')}
      />
      {rows.length > 0 ? (
        <View>
          {rows.slice(0, 3).map((row, i) => (
            <UpcomingRowView
              key={row.key}
              row={row}
              fmt={fmt}
              last={i === Math.min(rows.length, 3) - 1}
            />
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
  readonly ref?: RefObject<View | null>;
}

/** Equal tiles under the hero, four to a row: everything the screen offers in one place. */
export function QuickActions({
  tiles,
}: {
  tiles: readonly (Tile & { tone: 'brand' | 'positive' })[];
}) {
  const theme = useTheme();
  const rows: (typeof tiles)[number][][] = [];
  tiles.forEach((tile, i) => (i % 4 === 0 ? rows.push([tile]) : rows[rows.length - 1]!.push(tile)));
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {rows.map((row, r) => (
        <Row key={r} style={{ gap: theme.spacing.sm }}>
          {row.map((tile) => (
            <PressableScale
              key={tile.key}
              ref={tile.ref}
              accessibilityRole="button"
              accessibilityLabel={tile.label}
              onPress={tile.onPress}
              style={{
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
              }}
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
            </PressableScale>
          ))}
        </Row>
      ))}
    </View>
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
          <PressableScale
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            onPress={tile.onPress}
            style={{
              width: 84,
              minHeight: 72,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
              padding: theme.spacing.sm,
              borderRadius: theme.radius.md,
              backgroundColor: tint.bg,
            }}
          >
            <Ionicons name={tile.icon} size={iconSize.md} color={tint.ink} />
            <Text variant="micro" align="center" numberOfLines={2} style={{ fontWeight: '600' }}>
              {tile.label}
            </Text>
          </PressableScale>
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

/** The month on show, as a brand-coloured dropdown: a picker when there are
 *  other months to reach, and just the month's name when there are not. */
export function MonthPill({
  label,
  spokenLabel,
  onPress,
}: {
  label: string;
  spokenLabel: string;
  onPress?: (anchor: { x: number; y: number; width: number; height: number } | null) => void;
}) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${spokenLabel}. ${label}` : label}
      disabled={!onPress}
      onPress={onPress ? () => measureAnchor(ref, onPress) : undefined}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        maxWidth: 180,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        variant="caption"
        tone="brand"
        numberOfLines={1}
        style={{ flexShrink: 1, fontWeight: '700' }}
      >
        {label}
      </Text>
      {onPress ? (
        <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.brand} />
      ) : null}
    </Pressable>
  );
}
