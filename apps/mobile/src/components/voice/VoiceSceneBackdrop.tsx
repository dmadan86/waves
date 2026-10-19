/**
 * Home's time-of-day terrace scene, low and quiet along the foot of the capture
 * screen: the same photograph Home is wearing right now (the person's picked
 * background wins, as on Home), anchored to the bottom, its top running into
 * the page colour so there is no edge, and kept short so it never sits behind
 * the mic or the words being read.
 *
 * Decorative only: hidden from screen readers and never takes a touch.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@waves/ui';

import { HOME_HERO_PHOTOS } from '@/components/home/HomeHeroBackground';
import { useHomeHero } from '@/lib/useHomeHero';

/** The photographs share one 1440 × 640 frame. */
const RATIO = 1440 / 640;
const MAX_HEIGHT = 200;

export function VoiceSceneBackdrop() {
  const theme = useTheme();
  const hero = useHomeHero();
  const { width, height: screenHeight } = useWindowDimensions();
  const natural = width / RATIO;
  // A fifth of the screen at most, so a short phone keeps its room for content.
  const height = Math.min(natural, MAX_HEIGHT, screenHeight * 0.2);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, overflow: 'hidden' }}
    >
      <Image
        source={HOME_HERO_PHOTOS[hero]}
        resizeMode="cover"
        fadeDuration={0}
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width,
          height: natural,
          opacity: theme.scheme === 'dark' ? 0.55 : 0.75,
        }}
      />
      <LinearGradient
        colors={[theme.color.bg, `${theme.color.bg}00`]}
        locations={[0, 0.7]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
