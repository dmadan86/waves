/**
 * Personal home's plan pieces: the weekly / monthly recap banner (`only="recap"`)
 * and the one "Where you can save" tip as a compact row (`only="tip"`). All figures come from the
 * pure helpers in core (`personal/plan`).
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  format,
  money,
  recapTarget,
  resolveCategory,
  saveTips,
  type PlanInput,
  type SaveTip,
} from '@waves/core';
import { Card, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { markRecapOpened, openedRecaps, pauseTip, pausedTips } from '@/lib/personalPlanPrefs';
import { fill, plural, useStrings } from '@/i18n';

const tipId = (tip: SaveTip): string => `${tip.kind}:${tip.category ?? ''}`;

export function PersonalPlanCards({
  plan,
  ownerId,
  hidden,
  only,
}: {
  plan: PlanInput;
  ownerId: string | null;
  /** The eye on the summary card: mask every figure. */
  hidden: boolean;
  /** Draw just the recap banner or just the tip row; both by default. */
  only?: 'recap' | 'tip';
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

  return (
    <View style={{ gap: theme.spacing.md }}>
      {only !== 'tip' && showRecap && target ? (
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

      {only !== 'recap' && tip && !hidden ? (
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="bulb-outline" size={iconSize.md} color={theme.color.brand} />
          <Text variant="caption" style={{ flex: 1 }} numberOfLines={2}>
            {tipText(tip)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${tip.kind === 'subscriptions' ? p.review : p.setLimit}. ${tipText(tip)}`}
            hitSlop={8}
            onPress={() =>
              tip.kind === 'subscriptions' ? router.push('/personal/recurring') : setLimit(tip)
            }
          >
            <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
              {tip.kind === 'subscriptions' ? p.review : p.setLimit}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={p.notNow}
            hitSlop={8}
            onPress={() => {
              if (ownerId) void pauseTip(ownerId, tipId(tip), Date.now());
              setPaused((prev) => new Set([...prev, tipId(tip)]));
            }}
          >
            <Ionicons name="close" size={iconSize.sm} color={theme.color.textMuted} />
          </Pressable>
        </Row>
      ) : null}
    </View>
  );
}
