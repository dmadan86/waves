/**
 * Personal home's plan cards: the "left today" ring, the one "Where you can
 * save" tip, and the weekly / monthly recap prompt. All figures come from the
 * pure helpers in core (`personal/plan`).
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import {
  dayPlan,
  format,
  money,
  recapTarget,
  resolveCategory,
  saveTips,
  type PlanInput,
  type SaveTip,
} from '@waves/core';
import { Button, Card, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { markRecapOpened, openedRecaps, pauseTip, pausedTips } from '@/lib/personalPlanPrefs';
import { fill, plural, useStrings } from '@/i18n';

const RING = 68;
const STROKE = 8;

const tipId = (tip: SaveTip): string => `${tip.kind}:${tip.category ?? ''}`;

export function PersonalPlanCards({
  plan,
  ownerId,
  hidden,
}: {
  plan: PlanInput;
  ownerId: string | null;
  /** The eye on the summary card: mask every figure. */
  hidden: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const p = t.personalPlan;
  const currency = plan.currency;
  const fmt = (amount: bigint): string =>
    hidden ? BALANCE_MASK : format(money(amount, currency), { locale });

  // The clock is read once, off render.
  const [hour] = useState(() => new Date().getHours());
  const [paused, setPaused] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!ownerId) return;
    let live = true;
    void pausedTips(ownerId, Date.now()).then((v) => live && setPaused(v));
    void openedRecaps(ownerId).then((v) => live && setOpened(v));
    return () => {
      live = false;
    };
  }, [ownerId]);

  const day = dayPlan(plan);
  const tip = saveTips(plan).find((x) => !paused.has(tipId(x))) ?? null;
  const target = recapTarget(plan.today, hour);
  const recapId = target ? `${target.kind}:${target.key}` : null;
  const showRecap =
    target !== null && recapId !== null && !opened.includes(recapId) && plan.txns.length > 0;

  const categoryName = (key: string | null): string =>
    key === null
      ? t.personal.overall
      : (t.categories[
          (resolveCategory(key, null).builtinId ?? 'other') as keyof typeof t.categories
        ] ?? t.categories.other);

  const tipText = (x: SaveTip): string => {
    const amount = fmt(x.params.amount);
    if (x.kind === 'subscriptions') {
      return fill(plural(locale, x.params.count ?? 0, t.personalPlan.tip.subscriptions), {
        amount,
      });
    }
    return fill(t.personalPlan.tip[x.kind], { amount, category: categoryName(x.category) });
  };

  const openRecap = (): void => {
    if (!target || !recapId) return;
    if (ownerId) void markRecapOpened(ownerId, recapId);
    setOpened((prev) => [...prev, recapId]);
    router.push({ pathname: '/personal/recap', params: { kind: target.kind, key: target.key } });
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

  const setLimit = (x: SaveTip): void =>
    router.push({
      pathname: '/personal/budgets',
      params: {
        category: x.category ?? '',
        ...(x.params.usual !== undefined ? { limit: String(x.params.usual) } : {}),
      },
    });

  const left = day && day.leftToday > 0n ? day.leftToday : 0n;
  const fraction =
    day && day.perDay > 0n ? Math.min(1, Number((left * 1000n) / day.perDay) / 1000) : 0;
  const radius = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {showRecap && target ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            target.kind === 'week'
              ? p.recap.weekReady
              : fill(p.recap.monthReady, { month: monthName(target.key) })
          }
          onPress={openRecap}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Card flat>
            <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
              <Ionicons name="sparkles" size={iconSize.md} color={theme.color.brand} />
              <Text variant="body" style={{ flex: 1, fontWeight: '700' }} numberOfLines={2}>
                {target.kind === 'week'
                  ? p.recap.weekReady
                  : fill(p.recap.monthReady, { month: monthName(target.key) })}
              </Text>
              <Text variant="caption" tone="brand">
                {p.recap.seeIt}
              </Text>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.brand}
              />
            </Row>
          </Card>
        </Pressable>
      ) : null}

      {day ? (
        <Card flat>
          <Row
            accessible
            accessibilityLabel={`${hidden ? '' : fill(p.leftToday, { amount: fmt(left) })}. ${fill(p.leftWeek, { amount: fmt(day.leftThisWeek > 0n ? day.leftThisWeek : 0n) })}`}
            style={{ alignItems: 'center', gap: theme.spacing.lg }}
          >
            <Svg width={RING} height={RING} style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle
                cx={RING / 2}
                cy={RING / 2}
                r={radius}
                stroke={theme.color.surfaceMuted}
                strokeWidth={STROKE}
                fill="none"
              />
              <Circle
                cx={RING / 2}
                cy={RING / 2}
                r={radius}
                stroke={theme.color.brand}
                strokeWidth={STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${circumference * fraction} ${circumference}`}
              />
            </Svg>
            <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                style={{ fontSize: 26, lineHeight: 32, fontWeight: '700' }}
              >
                {fmt(left)}
              </Text>
              <Text variant="caption" tone="muted">
                {day.leftToday < 0n ? p.overToday : p.leftTodayShort}
              </Text>
              <View
                style={{
                  alignSelf: 'flex-start',
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.surfaceMuted,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: 3,
                }}
              >
                <Text variant="micro" numberOfLines={1}>
                  {fill(p.leftWeek, { amount: fmt(day.leftThisWeek > 0n ? day.leftThisWeek : 0n) })}
                </Text>
              </View>
            </View>
          </Row>
        </Card>
      ) : null}

      {tip && !hidden ? (
        <Card flat style={{ gap: theme.spacing.sm }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="bulb-outline" size={iconSize.md} color={theme.color.brand} />
            <Text variant="caption" tone="muted">
              {p.saveTitle}
            </Text>
          </Row>
          <Text variant="body">{tipText(tip)}</Text>
          <Row style={{ gap: theme.spacing.sm }}>
            <Button
              size="sm"
              label={tip.kind === 'subscriptions' ? p.review : p.setLimit}
              onPress={() =>
                tip.kind === 'subscriptions' ? router.push('/personal/recurring') : setLimit(tip)
              }
            />
            <Button
              size="sm"
              variant="ghost"
              label={p.notNow}
              onPress={() => {
                if (ownerId) void pauseTip(ownerId, tipId(tip), Date.now());
                setPaused((prev) => new Set([...prev, tipId(tip)]));
              }}
            />
          </Row>
        </Card>
      ) : null}
    </View>
  );
}
