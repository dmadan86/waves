/**
 * The standard screen header: a short photo band (the sea, the horizon, the
 * terrace) with a back chevron, a centred title and, optionally, a row of pills
 * underneath. The first card of the screen rides up over its foot by
 * `SCENIC_OVERLAP`.
 *
 * See docs/design-standard.md — every new or touched screen starts here.
 *
 * Put it first in the screen's scroll content (or a list's header), then start
 * the body in a `ScenicBody` so the overlap and the side gutters are right.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useHeroStatusBar } from '@/components/ScreenHero';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

const SCENE = require('../../../assets/images/voice-scene.webp') as number;
/** The photograph is 849 × 1852. */
const SCENE_W = 849;
const SCENE_H = 1852;
/** Where the sea's horizon is in the photograph, and where it lands on screen (dp). */
const SCENE_HORIZON = 1140;
const HORIZON_Y = 52;
/** The first card's top edge sits a fifth of the way down the screen. */
const CARD_TOP = 0.2;
/** How far the photo carries on behind the first card. */
export const SCENIC_OVERLAP = 36;

export function ScenicHeader({
  title,
  onBack,
  children,
}: {
  title: string;
  /** Defaults to going back one screen. */
  onBack?: () => void;
  /** The pill row under the title. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const dark = theme.scheme === 'dark';
  useHeroStatusBar(dark ? 'light' : 'dark');

  const photoH = Math.round(height * CARD_TOP) + SCENIC_OVERLAP;
  const scale = width / SCENE_W;
  const ink = theme.color.text;
  return (
    <View style={{ height: photoH, overflow: 'hidden' }}>
      <Image
        source={SCENE}
        accessibilityIgnoresInvertColors
        accessibilityElementsHidden
        importantForAccessibility="no"
        fadeDuration={0}
        style={{
          position: 'absolute',
          width: SCENE_W * scale,
          height: SCENE_H * scale,
          left: (width - SCENE_W * scale) / 2,
          top: HORIZON_Y - SCENE_HORIZON * scale,
        }}
      />
      {dark ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
          }}
        />
      ) : null}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', theme.color.bg]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 }}
      />
      <View
        style={{ paddingTop: insets.top + theme.spacing.sm, paddingHorizontal: theme.spacing.lg }}
      >
        <Row style={{ alignItems: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            onPress={onBack ?? (() => router.back())}
            hitSlop={8}
            style={{ width: 40, height: 40, justifyContent: 'center' }}
          >
            <Ionicons name={directionalIcon('chevron-back')} size={iconSize.xl} color={ink} />
          </Pressable>
          <Text
            variant="heading"
            align="center"
            accessibilityRole="header"
            numberOfLines={1}
            style={{ flex: 1, fontSize: 22, fontWeight: '800' }}
          >
            {title}
          </Text>
          <View style={{ width: 40 }} />
        </Row>
        {children ? (
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
            {children}
          </Row>
        ) : null}
      </View>
    </View>
  );
}

/** The body under a `ScenicHeader`: rides up over the photo, with the standard gutters and gaps. */
export function ScenicBody({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginTop: -SCENIC_OVERLAP,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.xl,
      }}
    >
      {children}
    </View>
  );
}
