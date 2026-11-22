/**
 * The weekly / monthly recap: a short four-page story, one page at a time, on
 * one screen (tap anywhere or Next). `?kind=week|month` and `?key=` (the
 * week's Monday, or the YYYY-MM) say which; without a key it recaps the latest
 * finished week or month. Figures come from core's `personal/plan`.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';

import {
  addPlanDays,
  format,
  monthRecap,
  money,
  recentMonths,
  resolveCategory,
  weekRecap,
  weekStartOf,
} from '@waves/core';
import { Button, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { fill, plural, useStrings } from '@/i18n';

const PAGES = 4;

function RecapBody() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const p = t.personalPlan;
  const dc = useDefaultCurrency();
  const ledger = usePersonalLedger();
  const { hidden } = usePersonalAmountsHidden();
  const params = useLocalSearchParams<{ kind?: string; key?: string }>();
  const [today] = useState(() => todayIso());
  const [page, setPage] = useState(0);

  const kind = params.kind === 'month' ? 'month' : 'week';
  const fmt = (amount: bigint): string =>
    hidden ? BALANCE_MASK : format(money(amount, dc), { locale, trimZeros: true });
  const abs = (n: bigint): bigint => (n < 0n ? -n : n);
  const categoryName = (key: string | null): string =>
    t.categories[(resolveCategory(key, null).builtinId ?? 'other') as keyof typeof t.categories] ??
    t.categories.other;
  const day = (date: string): string => {
    try {
      return dateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        new Date(`${date}T00:00:00Z`),
      );
    } catch {
      return date;
    }
  };
  const monthName = (month: string): string => {
    try {
      return dateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
        new Date(`${month}-01T00:00:00Z`),
      );
    } catch {
      return month;
    }
  };

  const input = { ...ledger, currency: dc, today };
  let pages: {
    eyebrow: string;
    headline: string;
    detail?: string;
    bars?: { label: string; value: bigint }[];
  }[];

  if (kind === 'week') {
    const start = params.key ?? addPlanDays(weekStartOf(today), -7);
    const r = weekRecap(input, start);
    const vs = r.vsUsual;
    pages = [
      { eyebrow: `${day(r.from)} – ${day(r.to)}`, headline: `${p.recap.youSpent} ${fmt(r.spent)}` },
      {
        eyebrow: p.recap.weekTitle,
        headline: !vs
          ? p.recap.vsNone
          : vs.delta === 0n
            ? p.recap.vsSame
            : fill(vs.delta < 0n ? p.recap.vsLess : p.recap.vsMore, { amount: fmt(abs(vs.delta)) }),
      },
      {
        eyebrow: p.recap.biggest,
        headline: r.topCategory ? categoryName(r.topCategory.category) : p.recap.noSpend,
        detail: r.topCategory ? fmt(r.topCategory.spent) : undefined,
      },
      {
        eyebrow: p.recap.nextBill,
        headline: r.nextBill
          ? r.nextBill.rule.note?.trim() || categoryName(r.nextBill.rule.category)
          : p.recap.noBill,
        detail: r.nextBill ? `${fmt(r.nextBill.rule.amount)} · ${day(r.nextBill.date)}` : undefined,
      },
    ];
  } else {
    const month = params.key ?? recentMonths(today.slice(0, 7), 2)[0]!;
    const r = monthRecap(ledger.txns, month, dc);
    const over = r.leftOver < 0n;
    pages = [
      {
        eyebrow: p.recap.monthTitle,
        headline: fill(over ? p.recap.overIncome : p.recap.leftOver, {
          month: monthName(month),
          amount: fmt(abs(r.leftOver)),
        }),
      },
      r.rank
        ? {
            eyebrow: monthName(month),
            headline: plural(
              locale,
              r.rankMonths,
              r.rank === 'best' ? p.recap.best : p.recap.worst,
            ),
          }
        : { eyebrow: monthName(month), headline: `${p.recap.youSpent} ${fmt(r.spent)}` },
      {
        eyebrow: p.recap.biggest,
        headline: r.topCategory ? categoryName(r.topCategory.category) : p.recap.noSpend,
        detail: r.topCategory ? fmt(r.topCategory.spent) : undefined,
      },
      {
        eyebrow: p.recap.trend,
        headline: '',
        bars: r.trend.map((x) => ({ label: monthName(x.month), value: x.spent })),
      },
    ];
  }

  const current = pages[page]!;
  const last = page === PAGES - 1;
  const advance = (): void => (last ? router.back() : setPage(page + 1));
  const peak = Math.max(1, ...(current.bars ?? []).map((b) => Number(b.value)));

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={p.recap.close} onPress={() => router.back()}>
          <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
        <Row
          accessible
          accessibilityLabel={fill(p.recap.page, { n: page + 1, total: PAGES })}
          style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.sm }}
        >
          {pages.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === page ? 20 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === page ? theme.color.brand : theme.color.surfaceMuted,
              }}
            />
          ))}
        </Row>
        <View style={{ width: 44 }} />
      </Row>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${current.eyebrow}. ${current.headline}. ${current.detail ?? ''}`}
        onPress={advance}
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.xl,
          gap: theme.spacing.md,
        }}
      >
        <Text variant="caption" tone="muted" align="center">
          {current.eyebrow}
        </Text>
        {current.bars ? (
          <Row style={{ height: 160, alignItems: 'flex-end', gap: theme.spacing.sm }}>
            {current.bars.map((b, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', gap: theme.spacing.xs }}>
                <View
                  style={{
                    width: '100%',
                    height: Math.max(4, (Number(b.value) / peak) * 120),
                    borderRadius: 6,
                    backgroundColor:
                      i === current.bars!.length - 1 ? theme.color.brand : theme.color.surfaceMuted,
                  }}
                />
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {b.label}
                </Text>
              </View>
            ))}
          </Row>
        ) : (
          <Text variant="display" align="center">
            {current.headline}
          </Text>
        )}
        {current.detail ? (
          <Text variant="heading" tone="muted" align="center">
            {current.detail}
          </Text>
        ) : null}
      </Pressable>

      <View style={{ paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl }}>
        <Button label={last ? p.recap.done : p.recap.next} fullWidth onPress={advance} />
      </View>
    </Screen>
  );
}

export default function RecapScreen() {
  return (
    <PersonalGuard>
      <RecapBody />
    </PersonalGuard>
  );
}
