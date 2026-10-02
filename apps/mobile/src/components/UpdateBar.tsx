/**
 * The update bar: a compact card just above the navigation that says a new
 * version is ready, and carries the whole update from there — a small drawing
 * (a tilted phone taking a download), the title and one line, one pill.
 *
 *   - **Update** — Play's own "Update available" sheet on Android, the App Store
 *     page on iOS. A small ✕ puts this version away.
 *   - **Downloading** — Play downloads in the background and the app stays
 *     usable; a hairline along the card's foot fills as it goes.
 *   - **Restart** — downloaded, and the moment is the person's: Play installs
 *     and the app comes back on the new version.
 *
 * Mounted with the navigation (`AppTabBar`), so it is there on every screen
 * the bar is, and gone where the bar is. It stands aside while any popup holds
 * the screen — the prompt queue's rule that only one thing asks at a time.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Animated, Pressable, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Gradient, Row, Text, useTheme, type Theme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { usePromptQueueClear } from '@/lib/promptQueue';
import { useStoreUpdate } from '@/lib/storeUpdate';

/** The navigation bar's own height (`PillTabBar`), which this card sits on. */
const NAV_HEIGHT = 60;
/** How far the raised mic button stands above the bar; the card clears it. */
const MIC_RISE = 28;

export function UpdateBar() {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const clear = usePromptQueueClear();
  const { phase, update, restart, dismiss } = useStoreUpdate();
  const showing = phase.kind !== 'none' && clear;

  // Rises into place rather than appearing: the one bit of ceremony an update
  // is worth.
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(rise, {
      toValue: showing ? 1 : 0,
      useNativeDriver: true,
      damping: 22,
      stiffness: 220,
      mass: 0.9,
    }).start();
  }, [rise, showing]);

  if (!showing) return null;

  const progress = phase.kind === 'downloading' ? phase.progress : null;
  const subtitle =
    phase.kind === 'ready'
      ? t.storeUpdate.ready
      : phase.kind === 'downloading'
        ? t.storeUpdate.downloading
        : t.storeUpdate.available;
  // While downloading, the pill counts the percent.
  const action =
    phase.kind === 'ready'
      ? t.storeUpdate.restart
      : phase.kind === 'downloading'
        ? progress === null
          ? t.storeUpdate.downloadingAction
          : `${Math.round(progress * 100)}%`
        : t.misc.update;
  const onAction = phase.kind === 'ready' ? restart : phase.kind === 'available' ? update : null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: theme.spacing.md,
        right: theme.spacing.md,
        bottom: insets.bottom + NAV_HEIGHT + MIC_RISE + theme.spacing.xs,
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }}
    >
      <View
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={{
          overflow: 'hidden',
          borderRadius: theme.radius.xl,
          backgroundColor: theme.color.surface,
          borderWidth: 1,
          borderColor: theme.color.border,
          ...theme.shadow.lifted,
        }}
      >
        <Row
          style={{
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingVertical: 8,
            paddingStart: 6,
            paddingEnd: 10,
          }}
        >
          <UpdateArt theme={theme} done={phase.kind === 'ready'} />

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: '700', color: theme.color.text }}
            >
              {t.misc.updateWaves}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.color.textMuted }}>
              {subtitle}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: !onAction, busy: phase.kind === 'downloading' }}
            disabled={!onAction}
            onPress={onAction ?? undefined}
            style={({ pressed }) => ({
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            })}
          >
            {onAction ? (
              <Gradient
                colors={theme.gradient.brand}
                radius={theme.radius.pill}
                style={{ paddingStart: 14, paddingEnd: 8, height: 34, justifyContent: 'center' }}
              >
                <Row style={{ alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.color.onBrand }}>
                    {action}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.color.onBrand} />
                </Row>
              </Gradient>
            ) : (
              <View
                style={{
                  paddingHorizontal: 14,
                  height: 34,
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.color.brand }}>
                  {action}
                </Text>
              </View>
            )}
          </Pressable>

          {phase.kind === 'available' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.storeUpdate.notNow}
              onPress={dismiss}
              hitSlop={10}
              style={({ pressed }) => ({
                width: 26,
                height: 26,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.surfaceMuted,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="close" size={15} color={theme.color.textMuted} />
            </Pressable>
          ) : null}
        </Row>

        {/* The download's progress, as a hairline along the card's foot. An
            unknown size shows a short brand stub rather than a false number. */}
        {phase.kind === 'downloading' ? (
          <View style={{ height: 3, backgroundColor: theme.color.brandSoft }}>
            <View
              style={{
                height: 3,
                width: `${Math.round((progress ?? 0.08) * 100)}%`,
                backgroundColor: theme.color.brand,
              }}
            />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** A four-point sparkle centred on (x, y). */
function sparkle(x: number, y: number, r: number): string {
  return `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
}

const GOLD = '#F5B83D';

/**
 * The card's picture: a phone tilted back on a little cloud, a brand tile on
 * its screen with a download arrow (a tick once the update is in), and
 * sparkles around it. Drawn, not an image, so it takes the theme's colours.
 */
function UpdateArt({ theme, done }: { theme: Theme; done: boolean }) {
  const [from, to] = [
    theme.gradient.brand[0],
    theme.gradient.brand[theme.gradient.brand.length - 1],
  ];
  return (
    <Svg width={44} height={46} viewBox="0 0 100 104" accessible={false}>
      <Defs>
        <LinearGradient id="ua-body" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={theme.color.surface} />
          <Stop offset="1" stopColor={theme.color.brandSoft} />
        </LinearGradient>
        <LinearGradient id="ua-tile" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>

      {/* cloud */}
      <G fill={theme.color.brandSoft}>
        <Circle cx={16} cy={92} r={11} />
        <Circle cx={34} cy={86} r={15} />
        <Circle cx={56} cy={90} r={13} />
        <Circle cx={74} cy={95} r={9} />
        <Circle cx={46} cy={97} r={7} />
      </G>

      {/* phone */}
      <G transform="rotate(-16 50 54)">
        <Rect
          x={29}
          y={14}
          width={42}
          height={76}
          rx={10}
          fill="url(#ua-body)"
          stroke={theme.color.brand}
          strokeWidth={2.5}
        />
        <Rect
          x={34}
          y={21}
          width={32}
          height={62}
          rx={6}
          fill={theme.color.surface}
          opacity={0.8}
        />
        <Rect x={44} y={16.8} width={12} height={2} rx={1} fill={theme.color.brand} opacity={0.5} />
        <Rect x={37} y={39} width={26} height={26} rx={7} fill="url(#ua-tile)" />
        {done ? (
          <Path
            d="M43.5 52.5l4.5 4.5 8.5-9"
            stroke="#FFFFFF"
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : (
          <Path
            d="M50 44v11M45 50.5l5 5 5-5M44 59.5h12"
            stroke="#FFFFFF"
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </G>

      {/* sparkles */}
      <Path d={sparkle(80, 16, 7)} fill={GOLD} />
      <Path d={sparkle(91, 38, 5)} fill={theme.color.brand} />
      <Path d={sparkle(10, 52, 5.5)} fill={GOLD} />
      <Circle cx={22} cy={72} r={1.6} fill={theme.color.brand} />
    </Svg>
  );
}
