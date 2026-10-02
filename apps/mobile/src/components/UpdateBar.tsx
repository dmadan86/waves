/**
 * The update bar: a quiet card just above the navigation that says a new
 * version is ready, and carries the whole update from there.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Gradient, iconSize, Row, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
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
        ? progress === null
          ? t.storeUpdate.downloading
          : fill(t.storeUpdate.downloadingPercent, { percent: String(Math.round(progress * 100)) })
        : t.storeUpdate.available;
  const action =
    phase.kind === 'ready'
      ? t.storeUpdate.restart
      : phase.kind === 'downloading'
        ? t.storeUpdate.downloadingAction
        : t.misc.update;
  const onAction = phase.kind === 'ready' ? restart : phase.kind === 'available' ? update : null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: theme.spacing.lg,
        right: theme.spacing.lg,
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
        <Row style={{ alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons
              name={phase.kind === 'ready' ? 'sparkles' : 'phone-portrait-outline'}
              size={iconSize.md}
              color={theme.color.brand}
            />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: '700', color: theme.color.text }}
            >
              {t.misc.updateWaves}
            </Text>
            <Text variant="micro" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: !onAction, busy: phase.kind === 'downloading' }}
            disabled={!onAction}
            onPress={onAction ?? undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            {onAction ? (
              <Gradient
                colors={theme.gradient.brand}
                radius={theme.radius.pill}
                style={{
                  paddingHorizontal: theme.spacing.lg,
                  height: 38,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.color.onBrand }}>
                  {action}
                </Text>
              </Gradient>
            ) : (
              <View
                style={{
                  paddingHorizontal: theme.spacing.lg,
                  height: 38,
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.color.brand }}>
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
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Ionicons name="close" size={iconSize.md} color={theme.color.textMuted} />
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
