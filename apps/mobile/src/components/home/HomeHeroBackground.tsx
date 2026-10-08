/**
 * Home's header scenery: one of nine bundled photographs (`lib/homeHeroPure`),
 * all cut to the same 2.25:1 frame so a change of scene is the same view
 * changing with the hour or the season.
 *
 *   photo   `cover`-fitted and anchored to the bottom, so the horizon and the
 *           foreground sit low and any cropping takes sky from the top
 *   scrim   a dark-to-clear shade over the status bar and greeting, so the
 *           white text and icons read on the brightest sky
 *   fade    the photo's foot running into the page colour (a theme token, so
 *           dark mode too), with no hard edge behind the balance card
 *
 * Decorative only. The swap between scenes cross-fades briefly, and not at all
 * when the person has asked for reduced motion.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Image, useWindowDimensions, View } from 'react-native';

import type { HomeHero } from '@/lib/homeHeroPure';
import { useReducedMotion } from '@/lib/reducedMotion';

export const HOME_HERO_PHOTOS: Readonly<Record<HomeHero, number>> = {
  morning: require('../../../assets/images/home-hero/morning.webp') as number,
  'late-morning': require('../../../assets/images/home-hero/late-morning.webp') as number,
  afternoon: require('../../../assets/images/home-hero/afternoon.webp') as number,
  evening: require('../../../assets/images/home-hero/evening.webp') as number,
  sunset: require('../../../assets/images/home-hero/sunset.webp') as number,
  night: require('../../../assets/images/home-hero/night.webp') as number,
  rainy: require('../../../assets/images/home-hero/rainy.webp') as number,
  autumn: require('../../../assets/images/home-hero/autumn.webp') as number,
  spring: require('../../../assets/images/home-hero/spring.webp') as number,
};

/** The scrim's stops, top to bottom: 34% down to nothing by the greeting's foot. */
export const HERO_SCRIM_COLORS = [
  'rgba(8, 12, 32, 0.34)',
  'rgba(8, 12, 32, 0.16)',
  'rgba(8, 12, 32, 0)',
] as const;
export const HERO_SCRIM_LOCATIONS = [0, 0.6, 1] as const;

/** Every photograph's size (they share one 2.25:1 frame). */
const PHOTO_W = 1440;
const PHOTO_H = 640;

/** Where the page fade begins, as a share of the photo's height. */
export const HERO_FADE_FROM = 0.55;

export function HomeHeroBackground({
  hero,
  height,
  photoHeight,
  scrimHeight,
  pageColor,
}: {
  hero: HomeHero;
  /** The box the background fills (the blur target's height). */
  height: number;
  /** How tall the photograph is, status bar included: ~180–220. */
  photoHeight: number;
  /** How far down the top scrim runs: to the greeting row's foot. */
  scrimHeight: number;
  /** The page behind the hero, which the photo's foot fades into. */
  pageColor: string;
}) {
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  if (height <= 0) return null;
  const photoH = Math.min(photoHeight, height);
  // `cover` by hand, anchored to the bottom and centred across: the same
  // explicit-size react-native Image the Friends and Review heroes use, which
  // renders bundled photos in release builds (expo-image left this blank).
  const scale = Math.max(width / PHOTO_W, photoH / PHOTO_H);
  const renderedW = PHOTO_W * scale;
  const renderedH = PHOTO_H * scale;
  // Flat, like FriendsHeroBackground: the photo and its two shades are direct
  // siblings at explicit sizes. Nested clipping views left the bundled photo
  // undrawn inside the blur target on Android.
  return (
    <>
      <Image
        key={hero}
        source={HOME_HERO_PHOTOS[hero]}
        fadeDuration={reduceMotion ? 0 : 300}
        accessibilityIgnoresInvertColors
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          position: 'absolute',
          width: renderedW,
          height: renderedH,
          left: (width - renderedW) / 2,
          top: photoH - renderedH,
        }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={HERO_SCRIM_COLORS}
        locations={HERO_SCRIM_LOCATIONS}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: scrimHeight }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[`${pageColor}00`, `${pageColor}B3`, pageColor]}
        locations={[HERO_FADE_FROM, HERO_FADE_FROM + (1 - HERO_FADE_FROM) * 0.55, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: photoH }}
      />
      {height > photoH ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: photoH,
            height: height - photoH,
            backgroundColor: pageColor,
          }}
        />
      ) : null}
    </>
  );
}
