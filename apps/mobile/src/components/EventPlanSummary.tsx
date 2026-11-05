/**
 * The Event Plan screen's plain header and its Planned / Spent / Left-or-Over
 * card (docs/event-organizer.md). The reading itself is `lib/planSummary`: no
 * budget shows Spent alone with "No budget set" (never a red bar); Left when
 * under, Over only when a budget exists and is exceeded.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, ChipRow, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { TranslucentBackButton } from '@/components/ContactPickerScene';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { fill, useStrings } from '@/i18n';
import { planSummary } from '@/lib/planSummary';
import { router } from '@/lib/navigation';

const BACK_BUTTON = 44;

/** The plain "Plan" header: back button, title and a one-line subtitle. */
export function EventPlanHeader() {
  const theme = useTheme();
  const { t } = useStrings();
  const insetsTop = useSafeAreaInsets().top;
  useHeroStatusBar(theme.scheme === 'dark' ? 'light' : 'dark');

  return (
    <View>
      <View
        style={{
          paddingTop: insetsTop + theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.sm,
          gap: 2,
        }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <TranslucentBackButton label={t.common.back} onPress={() => router.back()} />
          <Text
            variant="subheading"
            accessibilityRole="header"
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {t.plan}
          </Text>
        </Row>
        <Text
          variant="micro"
          numberOfLines={1}
          tone="muted"
          style={{ marginStart: BACK_BUTTON + theme.spacing.sm }}
        >
          {t.eventOrganizer.planSubtitle}
        </Text>
      </View>
    </View>
  );
}

/** One scope of the plan: the whole event, or one sub-event. */
export interface PlanScope {
  /** Null for "Overall". */
  readonly id: string | null;
  readonly label: string;
  readonly plannedMinor: bigint;
  readonly spentMinor: bigint;
}

export function EventPlanSummary({
  currency,
  scopes,
}: {
  currency: string;
  scopes: readonly PlanScope[];
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const o = t.eventOrganizer;
  const [scopeKey, setScopeKey] = useState('all');
  const scope = scopes.find((s) => (s.id ?? 'all') === scopeKey) ?? scopes[0]!;
  const summary = planSummary(scope.plannedMinor, scope.spentMinor);
  const over = summary.state === 'over';
  const tone = over ? theme.color.negative : theme.color.positive;

  const stat = (
    icon:
      'document-text-outline' | 'wallet-outline' | 'trending-up-outline' | 'trending-down-outline',
    color: string,
    soft: string,
    label: string,
    amount: bigint,
  ) => (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={label}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: soft,
          }}
        >
          <Ionicons name={icon} size={iconSize.sm} color={color} />
        </View>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {label}
        </Text>
      </Row>
      <MoneyText amount={amount} currency={currency} locale={locale} variant="subheading" />
    </View>
  );

  return (
    <Card style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
        <Text variant="subheading">{t.plan}</Text>
      </Row>
      {scopes.length > 1 ? (
        <ChipRow<string>
          value={scopeKey}
          onChange={setScopeKey}
          options={scopes.map((s) => ({ value: s.id ?? 'all', label: s.label }))}
        />
      ) : null}
      <Row style={{ gap: theme.spacing.md }}>
        {summary.state !== 'none'
          ? stat(
              'document-text-outline',
              theme.color.brand,
              theme.color.brandSoft,
              t.planned,
              summary.plannedMinor,
            )
          : null}
        {stat(
          'wallet-outline',
          theme.color.positive,
          theme.color.positiveSoft,
          t.spent,
          summary.spentMinor,
        )}
        {summary.state !== 'none'
          ? stat(
              over ? 'trending-up-outline' : 'trending-down-outline',
              tone,
              over ? theme.color.negativeSoft : theme.color.positiveSoft,
              over ? o.statOver : o.statLeft,
              summary.gapMinor,
            )
          : null}
      </Row>
      {summary.state === 'none' ? (
        <Text variant="caption" tone="muted">
          {o.noBudgetSet}
        </Text>
      ) : (
        <>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: summary.percentUsed }}
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: theme.color.border,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${summary.percentUsed}%`,
                height: '100%',
                backgroundColor: tone,
                borderRadius: 3,
              }}
            />
          </View>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="micro" tone="muted">
              {fill(o.percentUsed, { n: summary.percentUsed })}
            </Text>
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <MoneyText
                amount={summary.gapMinor}
                currency={currency}
                locale={locale}
                variant="micro"
                mode="plain"
              />
              <Text variant="micro" tone={over ? 'negative' : 'muted'}>
                {over ? o.statOver : o.statLeft}
              </Text>
            </Row>
          </Row>
        </>
      )}
    </Card>
  );
}
