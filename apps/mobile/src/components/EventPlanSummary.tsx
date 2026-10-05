/**
 * The Event Plan screen's scenic header and its Planned / Spent / Left-or-Over
 * card (docs/event-organizer.md). The reading itself is `lib/planSummary`: no
 * budget shows Spent alone with "No budget set" (never a red bar); Left when
 * under, Over only when a budget exists and is exceeded.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, ChipRow, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { TranslucentBackButton } from '@/components/ContactPickerScene';
import { HeroScene } from '@/components/home/HeroScene';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { fill, useStrings } from '@/i18n';
import { useHeroScene } from '@/lib/heroScenePreference';
import { planSummary } from '@/lib/planSummary';
import { router } from '@/lib/navigation';
import { HERO_THEMES } from '@/lib/scene';

const BACK_BUTTON = 40;
const SCENE_ROOM = 16;
const SCENE_OVERLAP = 14;
const SCENE_INTO_CARD = 34;

/** The scenic "Plan" header: back button, title and a one-line subtitle. */
export function EventPlanHeader() {
  const theme = useTheme();
  const { t } = useStrings();
  const insetsTop = useSafeAreaInsets().top;
  const { width } = useWindowDimensions();
  const scene = useHeroScene();
  const [height, setHeight] = useState(0);
  const darkInk = HERO_THEMES[scene].ink === 'dark';
  useHeroStatusBar(darkInk ? 'dark' : 'light');
  const ink = darkInk ? theme.color.text : '#FFFFFF';

  return (
    <View style={{ marginBottom: -SCENE_OVERLAP }}>
      {height > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <HeroScene
            scene={scene}
            width={width}
            height={height + SCENE_INTO_CARD}
            horizon={height - SCENE_OVERLAP}
            headerBottom={insetsTop + BACK_BUTTON}
            pageColor={theme.color.bg}
          />
        </View>
      ) : null}
      <View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={{
          paddingTop: insetsTop + theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: SCENE_ROOM,
          gap: 2,
        }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <TranslucentBackButton
            dark={darkInk}
            label={t.common.back}
            onPress={() => router.back()}
          />
          <Text
            variant="subheading"
            accessibilityRole="header"
            numberOfLines={1}
            style={{ flex: 1, color: ink }}
          >
            {t.plan}
          </Text>
        </Row>
        <Text
          variant="micro"
          numberOfLines={1}
          style={{ marginStart: BACK_BUTTON + theme.spacing.sm, color: ink, opacity: 0.85 }}
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
