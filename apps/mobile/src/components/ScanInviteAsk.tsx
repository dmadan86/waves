/**
 * The pre-permission "ask" screen for the invite scanner — the first thing a
 * person sees before the camera is ever requested, and the only one of the
 * scanner's states that wears a photograph rather than the plain dark field.
 *
 * It exists for the same reason `app/captures/messages.tsx` (the SMS-read
 * disclosure) does: a permission ask reads as a wall when it is only a
 * sentence over black. A full-bleed desk photo with the invite QR already on
 * it says what scanning *is* before the system dialog ever interrupts, and
 * the bracket-and-sweep over the card echoes the live viewfinder the person
 * is about to land on, so the two screens read as one motion rather than a
 * photo cutting to a different app.
 *
 * Once permission is granted this never renders again — `ScannerCamera` goes
 * straight to the live feed, so the photo is only ever the ask, never the
 * fallback.
 */

import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Gradient, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { useReducedMotion } from '@/lib/reducedMotion';

const BACKGROUND = require('../../assets/images/scan-qr-background.webp') as number;

/** The wash over everything that is not the badge/title/sheet, top to clear —
 *  strong enough to carry white text over a bright part of the photo, and
 *  tall enough to settle the photo's own backdrop before it reaches the card. */
const SCRIM = ['rgba(8,8,22,0.88)', 'rgba(8,8,22,0.55)', 'rgba(8,8,22,0.02)'] as const;
const SCRIM_LOCATIONS = [0, 0.38, 0.62] as const;
/** The chip a floating control sits on. */
const GLASS = 'rgba(10, 10, 26, 0.55)';

/** The viewfinder square drawn over the photo's own card. */
const FRAME = 232;
const CORNER = 30;
const STROKE = 4;
/** How long one sweep of the scan line takes, up and back. */
const SWEEP_MS = 1500;

/** A title with its `[bracketed]` part drawn in brand purple — the two-tone
 *  pattern the rest of the app uses for a translated heading with one accented
 *  word (see `app/captures/messages.tsx`'s `AccentTitle`). */
function AccentTitle({ text }: { text: string }) {
  const theme = useTheme();
  const parts = text.split(/\[(.+?)\]/);
  return (
    <Text
      align="center"
      style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#FFFFFF' }}
    >
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text
            key={index}
            style={{ fontSize: 24, lineHeight: 30, fontWeight: '800', color: theme.color.brand }}
          >
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/** One corner of the viewfinder frame over the photo's card — white, unlike the
 *  live scanner's brand-tinted-on-found corners, since nothing is "found" yet. */
function FrameCorner({
  vertical,
  horizontal,
}: {
  vertical: 'top' | 'bottom';
  horizontal: 'left' | 'right';
}) {
  const theme = useTheme();
  const top = vertical === 'top';
  const left = horizontal === 'left';
  return (
    <View
      style={{
        position: 'absolute',
        top: top ? 0 : undefined,
        bottom: top ? undefined : 0,
        left: left ? 0 : undefined,
        right: left ? undefined : 0,
        width: CORNER,
        height: CORNER,
        borderColor: '#FFFFFF',
        borderTopWidth: top ? STROKE : 0,
        borderBottomWidth: top ? 0 : STROKE,
        borderLeftWidth: left ? STROKE : 0,
        borderRightWidth: left ? 0 : STROKE,
        borderTopLeftRadius: top && left ? theme.radius.lg : 0,
        borderTopRightRadius: top && !left ? theme.radius.lg : 0,
        borderBottomLeftRadius: !top && left ? theme.radius.lg : 0,
        borderBottomRightRadius: !top && !left ? theme.radius.lg : 0,
      }}
    />
  );
}

/** The purple line sweeping top to bottom inside the frame. Skipped entirely
 *  under reduced motion rather than frozen mid-frame, which would read as a
 *  stray purple bar rather than a deliberate mark. */
function ScanSweep() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const travel = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    travel.value = withRepeat(
      withSequence(
        withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: SWEEP_MS, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [reduceMotion, travel]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: travel.value * (FRAME - CORNER * 2 - 3) }],
    opacity: reduceMotion ? 0 : 1,
  }));

  if (reduceMotion) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: CORNER,
          left: CORNER,
          right: CORNER,
          height: 3,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.brand,
          shadowColor: theme.color.brand,
          shadowOpacity: 0.9,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}

/** One of the three small features under the paste pill: an icon in a soft
 *  circle, a bold one-line label and a one-line muted line, a third of the
 *  row each. Both lines are capped to one line on purpose — three short
 *  phrases read as a row; a wrapped one breaks the row's rhythm. */
function Feature({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 1, paddingHorizontal: 2 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={28} color={theme.color.brand} />
      </View>
      <Text
        align="center"
        numberOfLines={1}
        style={{ fontSize: 13, lineHeight: 15, fontWeight: '700', color: theme.color.text }}
      >
        {title}
      </Text>
      <Text
        align="center"
        numberOfLines={1}
        style={{ fontSize: 11, lineHeight: 13, color: theme.color.textMuted }}
      >
        {body}
      </Text>
    </View>
  );
}

export default function ScanInviteAsk({
  onAllow,
  onClose,
  onPasteLink,
}: {
  /** Requests camera permission. A grant hands straight to the live scanner —
   *  this screen never renders again once it resolves `granted`. */
  onAllow: () => void;
  onClose: () => void;
  onPasteLink: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useStrings();

  return (
    <View style={{ flex: 1, backgroundColor: '#14101F' }}>
      <Image
        source={BACKGROUND}
        contentFit="cover"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <LinearGradient
        colors={SCRIM}
        locations={SCRIM_LOCATIONS}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={{ flex: 1, paddingTop: insets.top + theme.spacing.sm }} pointerEvents="box-none">
        <Row style={{ paddingHorizontal: theme.spacing.xl }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: GLASS,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="close" size={iconSize.lg} color="#FFFFFF" />
          </Pressable>
        </Row>

        <View
          style={{
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: theme.spacing.xxl,
            paddingTop: theme.spacing.sm,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: theme.radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brand,
              ...theme.shadow.soft,
            }}
          >
            <Ionicons name="scan-outline" size={iconSize.xxl} color="#FFFFFF" />
          </View>
          <AccentTitle text={t.misc.scanAskTitle} />
          <Text
            align="center"
            numberOfLines={2}
            style={{
              fontSize: 14,
              lineHeight: 19,
              color: 'rgba(255,255,255,0.8)',
              maxWidth: 280,
            }}
          >
            {t.misc.scanAskSubtitle}
          </Text>
        </View>

        {/* The frame over the photo's own card, centred in whatever room is
            left between the words above and the sheet below. */}
        <View
          pointerEvents="none"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: FRAME }}
        >
          <View style={{ width: FRAME, height: FRAME }}>
            <FrameCorner vertical="top" horizontal="left" />
            <FrameCorner vertical="top" horizontal="right" />
            <FrameCorner vertical="bottom" horizontal="left" />
            <FrameCorner vertical="bottom" horizontal="right" />
            <ScanSweep />
          </View>
        </View>
      </View>

      {/* The white sheet, docked to the bottom edge — not a modal, so it keeps
          the card and the brackets above it in view rather than covering them. */}
      <View
        style={{
          backgroundColor: theme.color.surface,
          borderTopLeftRadius: theme.radius.xxl,
          borderTopRightRadius: theme.radius.xxl,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.sm,
          gap: theme.spacing.sm,
          ...theme.shadow.lifted,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.misc.scanAskAllow}
          onPress={onAllow}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <Gradient
            radius={theme.radius.pill}
            colors={theme.gradient.brand}
            style={{
              height: 46,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <Ionicons name="camera" size={iconSize.md} color="#FFFFFF" />
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
              {t.misc.scanAskAllow}
            </Text>
          </Gradient>
        </Pressable>

        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
          <Text variant="caption" tone="muted">
            {t.misc.scanAskOr}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: theme.color.border }} />
        </Row>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.misc.scanPasteLink}
          onPress={onPasteLink}
          style={({ pressed }) => ({
            height: 44,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.brandSoft,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.sm,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="link" size={iconSize.base} color={theme.color.brand} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.color.brand }}>
            {t.misc.scanPasteLink}
          </Text>
        </Pressable>

        <Row
          gap={0}
          style={{
            alignItems: 'center',
            minHeight: 64,
            paddingTop: theme.spacing.xs,
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
          }}
        >
          <Feature
            icon="shield-checkmark-outline"
            title={t.misc.scanAskFeatureSecureTitle}
            body={t.misc.scanAskFeatureSecureBody}
          />
          <View
            style={{
              width: 1,
              alignSelf: 'center',
              height: 36,
              backgroundColor: theme.color.border,
            }}
          />
          <Feature
            icon="flash-outline"
            title={t.misc.scanAskFeatureFastTitle}
            body={t.misc.scanAskFeatureFastBody}
          />
          <View
            style={{
              width: 1,
              alignSelf: 'center',
              height: 36,
              backgroundColor: theme.color.border,
            }}
          />
          <Feature
            icon="people-outline"
            title={t.misc.scanAskFeatureNoDataTitle}
            body={t.misc.scanAskFeatureNoDataBody}
          />
        </Row>
      </View>
    </View>
  );
}
