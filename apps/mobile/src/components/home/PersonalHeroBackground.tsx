/**
 * The Personal hero's background: one place — mountains over a lake, pines in
 * front — photographed at six moments (morning, afternoon, evening, sunset,
 * night, winter). The composition is the same in every one, so a change of
 * scene reads as the same view changing with the day or the season.
 *
 *   photo      the scene, `cover`-fitted: cropped to the hero, never stretched
 *   scrim      a dark shade from the top down to the figures, strong enough
 *              that the white text over it stays readable on the brightest sky
 *   fade       the photo's foot running into the page behind the tiles
 *
 * Decorative only: hidden from screen readers, and never in front of a figure.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, View } from 'react-native';

import { HERO_THEMES, Scene } from '@/lib/scene';

/** The six photographs, one per scene — also the Background picker's thumbnails. */
export const SCENE_PHOTOS: Readonly<Record<Scene, number>> = {
  [Scene.Morning]: require('../../../assets/images/scenes/morning.webp') as number,
  [Scene.Afternoon]: require('../../../assets/images/scenes/afternoon.webp') as number,
  [Scene.Evening]: require('../../../assets/images/scenes/evening.webp') as number,
  [Scene.Sunset]: require('../../../assets/images/scenes/sunset.webp') as number,
  [Scene.Night]: require('../../../assets/images/scenes/night.webp') as number,
  [Scene.Winter]: require('../../../assets/images/scenes/winter.webp') as number,
};

export function PersonalHeroBackground({
  scene,
  height,
  horizon,
  pageColor,
}: {
  scene: Scene;
  /** Down to where the scene ends — past the top of the tiles. */
  height: number;
  /** Where the tiles begin: the scrim runs down to here, the fade starts here. */
  horizon: number;
  /** The page behind the hero, which the photo's foot fades into. */
  pageColor: string;
}) {
  if (height <= 0) return null;
  const fadeFrom = Math.min(0.95, Math.max(0, (horizon - 24) / height));
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { height, overflow: 'hidden', backgroundColor: HERO_THEMES[scene].sky[0] },
      ]}
    >
      {/* `cover` keeps the picture's shape, centred, so a short hero loses sky
          and foreground rather than the mountains and the lake. */}
      <Image
        source={SCENE_PHOTOS[scene]}
        resizeMode="cover"
        fadeDuration={300}
        style={StyleSheet.absoluteFill}
      />
      {/* Readability: dark enough at the top for the white header and figure
          on a bright afternoon or winter sky, easing off towards the tiles. */}
      <LinearGradient
        colors={['rgba(8, 12, 32, 0.58)', 'rgba(8, 12, 32, 0.4)', 'rgba(8, 12, 32, 0.18)']}
        locations={[0, 0.55, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: horizon }}
      />
      {/* The foot: the photo runs into the page behind the tiles, gradually. */}
      <LinearGradient
        colors={[`${pageColor}00`, `${pageColor}B3`, pageColor]}
        locations={[fadeFrom, fadeFrom + (1 - fadeFrom) * 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
