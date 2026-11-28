/**
 * Home, coming up first: what is due, the next few payments, one row of small buttons, the
 * big bills of the year and the month in three numbers. One component for Personal and for a
 * couple/family space (`groupId`).
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { addPlanDays, format, money, type CurrencyCode } from '@waves/core';
import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import {
  EmptyCard,
  LIST_TILE,
  ListCard,
  ListItem,
  SectionHeader,
  StandardCard,
} from '@/components/standard';
import { useComingUp } from '@/data/useComingUp';
import { plural, fill, useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { router } from '@/lib/navigation';
import {
  applyFund,
  bigBills,
  bigBillsStatus,
  dueTag,
  expandDue,
  summarizeDue,
  type DueItem,
  type DueTag,
} from '@/lib/moneyCalendar';

/** A one-off cost counts as big from this many whole units of the currency. */
export const BIG_ONE_OFF_UNITS = 10000n;

export interface ComingUpTile {
  readonly key: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
}

export const calendarRoute = (groupId?: string): string =>
  groupId ? `/group/${groupId}/calendar` : '/personal/calendar';
export const bigBillsRoute = (groupId?: string): string =>
  groupId ? `/group/${groupId}/bigbills` : '/personal/bigbills';

/** Money in the default currency, masked when the person has hidden amounts. */
export function useDueMoney(dc: string): (minor: bigint) => string {
  const { locale } = useStrings();
  const { hidden } = usePersonalAmountsHidden();
  return (minor) =>
    hidden ? '••••' : format(money(minor, dc as CurrencyCode), { locale, trimZeros: true });
}

export function useTagText(): (item: DueItem, tag: DueTag) => string {
  const { t, locale } = useStrings();
  return (item, tag) => {
    switch (tag) {
      case 'overdue':
        return t.comingUp.tagOverdue;
      case 'auto':
        return t.comingUp.tagAuto;
      case 'setAside':
        return t.comingUp.tagSetAside;
      case 'renew':
        return t.comingUp.tagRenew;
      default:
        return item.inDays === 0
          ? t.comingUp.tagToday
          : plural(locale, item.inDays, t.personalHome.inDays).replace('{n}', String(item.inDays));
    }
  };
}

export function tagColor(theme: ReturnType<typeof useTheme>, tag: DueTag): string {
  if (tag === 'overdue') return theme.color.negative;
  if (tag === 'setAside') return theme.color.positive;
  if (tag === 'renew') return theme.color.brand;
  if (tag === 'inDays') return theme.color.warning;
  return theme.color.textMuted;
}

/** The date block, title/sub and amount/tag of one due row; also the calendar's list row. */
export function DueRow({
  item,
  fmt,
  first,
  onPress,
}: {
  item: DueItem;
  fmt: (minor: bigint) => string;
  first: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { locale } = useStrings();
  const tagText = useTagText();
  const tag = dueTag(item);
  const at = new Date(`${item.date}T00:00:00Z`);
  const mon = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(at);
  const day = at.getUTCDate();
  const amount = fmt(item.amount);
  return (
    <ListItem
      accessibilityLabel={`${item.title}, ${mon} ${day}, ${amount}, ${tagText(item, tag)}`}
      onPress={onPress}
      divider={!first}
      leading={
        <View style={{ width: LIST_TILE, alignItems: 'center' }}>
          <Text
            variant="micro"
            tone="muted"
            style={{ fontWeight: '600', textTransform: 'uppercase' }}
          >
            {mon}
          </Text>
          <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: '800' }}>{day}</Text>
        </View>
      }
      title={item.title}
      subtitle={item.sub}
      amount={item.amount <= 0n ? '' : `${item.income ? '+' : ''}${amount}`}
      caption={tagText(item, tag)}
      captionColor={tagColor(theme, tag)}
    />
  );
}

export function ComingUpHome({
  groupId,
  ledgerGroupId,
  currency,
  tiles,
  month,
}: {
  groupId?: string;
  ledgerGroupId?: string;
  currency?: string;
  tiles: readonly ComingUpTile[];
  month: { label: string; income: string; spent: string; left: string; leftNegative: boolean };
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const c = t.comingUp;
  const { sources, dc, today, fund, fundRules } = useComingUp({ groupId, ledgerGroupId, currency });
  const fmt = useDueMoney(dc);
  const [horizon, setHorizon] = useState<30 | 90>(30);

  const items = useMemo(
    () => expandDue(sources, today, addPlanDays(today, horizon)).filter((i) => !i.income),
    [sources, today, horizon],
  );
  const total = summarizeDue(items, dc);
  const big = useMemo(
    () => bigBills(sources, today, dc, BIG_ONE_OFF_UNITS * 100n),
    [sources, today, dc],
  );
  const covered = useMemo(
    () =>
      applyFund(
        items.filter((i) => i.currency === dc),
        big.occurrences,
        fund,
      ),
    [items, dc, fund, big.occurrences],
  );
  const next = covered.slice(0, 4);
  const hasFund = fundRules.size > 0 || fund > 0n;
  const status = bigBillsStatus(big.occurrences, fund);
  const fundShare = total.total > 0n ? Math.min(1, Number((fund * 1000n) / total.total) / 1000) : 0;
  const onBrand = '#FFFFFF';

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View
        style={{
          backgroundColor: theme.color.brand,
          borderRadius: theme.radius.lg,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
        }}
      >
        <Row
          style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={{ flex: 1, color: onBrand, opacity: 0.9, fontSize: 13 }}
          >
            {fill(c.dueTitle, { days: horizon })}
          </Text>
          <Row style={{ gap: 6 }}>
            {([30, 90] as const).map((d) => (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityState={{ selected: horizon === d }}
                accessibilityLabel={d === 30 ? c.days30 : c.days90}
                onPress={() => setHorizon(d)}
                hitSlop={{ top: 8, bottom: 8 }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 12,
                  backgroundColor: horizon === d ? 'rgba(255,255,255,0.22)' : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: onBrand,
                    fontSize: 12,
                    fontWeight: '600',
                    opacity: horizon === d ? 1 : 0.8,
                  }}
                >
                  {d === 30 ? c.days30 : c.days90}
                </Text>
              </Pressable>
            ))}
          </Row>
        </Row>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{ color: onBrand, fontSize: 34, lineHeight: 40, fontWeight: '800' }}
        >
          {fmt(total.total)}
        </Text>
        <Text style={{ color: onBrand, opacity: 0.9, fontSize: 13 }}>
          {[
            fill(plural(locale, total.count, c.paymentsCount), { n: total.count }),
            hasFund ? fill(c.alreadySetAside, { amount: fmt(fund) }) : null,
            total.others.length > 0 ? c.otherCurrencies : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {hasFund ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(fundShare * 100) }}
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: 'rgba(255,255,255,0.25)',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.round(fundShare * 100)}%`,
                height: 8,
                backgroundColor: onBrand,
              }}
            />
          </View>
        ) : null}
      </View>

      <ListCard>
        {next.length === 0 ? (
          <EmptyCard
            icon="calendar-outline"
            title={t.personalHome.emptyUpcomingTitle}
            helper={t.personalHome.emptyUpcomingHelp}
            action={{
              label: t.personalHome.addBill,
              onPress: () => router.push(addBillRoute(groupId)),
            }}
          />
        ) : (
          next.map((item, i) => (
            <DueRow
              key={item.key}
              item={item}
              fmt={fmt}
              first={i === 0}
              onPress={() => router.push(item.href as never)}
            />
          ))
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={c.seeCalendar}
          onPress={() => router.push(calendarRoute(groupId) as never)}
          style={{
            alignItems: 'center',
            paddingVertical: theme.spacing.md,
            borderTopWidth: next.length ? 1 : 0,
            borderTopColor: theme.color.border,
          }}
        >
          <Row style={{ alignItems: 'center', gap: 2 }}>
            <Text tone="brand" style={{ fontWeight: '600' }}>
              {c.seeCalendar}
            </Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.brand}
            />
          </Row>
        </Pressable>
      </ListCard>

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
              gap: 6,
              paddingVertical: 10,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface,
              borderWidth: theme.scheme === 'dark' ? 0 : 1,
              borderColor: theme.color.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Ionicons name={tile.icon} size={iconSize.md} color={theme.color.brand} />
            </View>
            <Text variant="micro" numberOfLines={1} style={{ fontWeight: '600' }}>
              {tile.label}
            </Text>
          </Pressable>
        ))}
      </Row>

      {big.total > 0n ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={c.bigTitle}
          onPress={() => router.push(bigBillsRoute(groupId) as never)}
        >
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <SectionHeader
              title={c.bigTitle}
              trailing={
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 12,
                    backgroundColor: status.onTrack
                      ? theme.color.positiveSoft
                      : theme.color.warningSoft,
                  }}
                >
                  <Text
                    variant="caption"
                    style={{
                      fontWeight: '700',
                      color: status.onTrack ? theme.color.positive : theme.color.warning,
                    }}
                  >
                    {status.onTrack ? c.onTrack : c.behind}
                  </Text>
                </View>
              }
            />
            <Text variant="caption" tone="muted">
              {fill(c.bigSub, { amount: fmt(big.total) })}
            </Text>
            <Text>{fill(c.bigSetAside, { amount: fmt(big.perMonth) })}</Text>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.color.surfaceMuted,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.round(status.ratio * 100)}%`,
                  height: 8,
                  backgroundColor: theme.color.positive,
                }}
              />
            </View>
          </StandardCard>
        </Pressable>
      ) : (
        <EmptyCard icon="umbrella-outline" title={c.bigTitle} helper={c.bigEmptyHelp} />
      )}

      <StandardCard style={{ gap: theme.spacing.sm }}>
        <SectionHeader
          title={c.thisMonth}
          trailing={
            <Text variant="caption" tone="muted">
              {month.label}
            </Text>
          }
        />
        <Row style={{ gap: theme.spacing.md }}>
          {[
            { label: c.inLabel, value: month.income, color: undefined },
            { label: c.spentLabel, value: month.spent, color: undefined },
            {
              label: c.leftLabel,
              value: month.left,
              color: month.leftNegative ? theme.color.negative : theme.color.positive,
            },
          ].map((cell) => (
            <View key={cell.label} style={{ flex: 1, minWidth: 0 }}>
              <Text variant="caption" tone="muted">
                {cell.label}
              </Text>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontWeight: '700', color: cell.color }}
              >
                {cell.value}
              </Text>
            </View>
          ))}
        </Row>
      </StandardCard>
    </View>
  );
}

/** Adding a bill: the add-recurring form for Personal, the add-bills screen for a space. */
export function addBillRoute(groupId?: string): never {
  return (
    groupId
      ? `/group/${groupId}/add-bills`
      : { pathname: '/personal/entry', params: { repeats: '1', addRecurring: '1' } }
  ) as never;
}
