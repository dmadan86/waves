/**
 * The animated splash — the bridge between the OS splash and the app.
 *
 * The launch has two splashes back to back, and the seam between them is meant
 * to be invisible. First the native one (a solid `SPLASH_BG` field with the
 * logo, configured in `app.json`'s `expo-splash-screen`) shows the instant the
 * process starts, while the JS is still loading. Then this component mounts,
 * hides the native splash, and paints an identical field on top — same colour,
 * same logo, same place — so nothing flickers at the handoff. From there it
 * plays: the logo settles in, holds a beat, and the whole field fades away to
 * reveal the app underneath.
 *
 * Native only. On web there is no native splash to hand off from, and a
 * full-screen overlay sitting over the app for a second would only get in the
 * way of the layout checks the web build exists for — so it renders nothing.
 *
 * One flat brand field with the mark in the middle of it, and nothing else —
 * the shape every app whose launch screen is remembered uses. It replaced a
 * diagonal navy wash carrying the word "waves" as text, which had a seam in it
 * nobody could unsee once told: the native half showed the mark and this half
 * showed the word, so the launch changed its mind halfway through.
 *
 * Both halves now draw the same PNG on the same colour at the same width, so
 * the handoff has nothing left to give away.
 *
 * To rebrand: `SPLASH_BG` and `MARK_WIDTH` here, `backgroundColor` and
 * `imageWidth` in `app.json`'s `expo-splash-screen`. They are two halves of one
 * picture — change all four together or the seam comes back.
 */
import { useCallback, useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/reducedMotion';

/** The field. Kept identical to `expo-splash-screen`'s `backgroundColor` in
    `app.json`, because the native splash is this same flat colour and this one
    is painted over it — any difference shows as a flash at the handoff.

    Yellow, and deliberately not one of the app's own colours: a launch screen
    is the one surface whose job is to be recognised across a home screen full
    of apps, which is what GoodRx's yellow and Spotify's black are for. The mark
    on it is the app's ink rather than white, because a white mark on this is
    unreadable. */
const SPLASH_BG = '#F5D800';

/** The mark's drawn width, identical to `imageWidth` in `app.json` for the same
    reason: the native half draws the same file, and a mark that changes size
    mid-launch is the seam in another form. */
const MARK_WIDTH = 140;

/** The mark in the app's ink, which is what reads on yellow. Same file the
    native splash is given. */
const MARK = require('../../assets/images/splash-mark-ink.png');

/**
 * The beats, in order.
 *
 * The rule that shapes all of them: **this half opens on the frame the native
 * half ended on.** The native splash is a still image — a flat field with the
 * mark at `imageWidth`, full size, full opacity — and it is on screen for as
 * long as Android takes to start the JS, which on a cold start is most of the
 * launch. So the first frame drawn here has to be that same picture.
 *
 * The old version faded the mark up from nothing and sprang it in from 0.72,
 * which after a second of a *static, full-size* mark read as the logo
 * flinching: it shrank, dimmed and bounced, all after having already arrived.
 * No amount of easing fixes that — the motion was starting from somewhere the
 * eye had not left it.
 *
 * What moves instead is the field. A slow diagonal wash comes up over the flat
 * yellow — a lighter yellow, through the brand colour, to a deeper amber — and
 * drifts across while the mark takes one small breath. The wash starts at zero
 * opacity, which is the flat native colour exactly, so there is still nothing
 * to see at the seam; only from the second frame on does the screen begin to
 * move.
 *
 * Then the whole field lifts *towards* the viewer as it fades — a scale past 1,
 * not a dissolve — so the app underneath reads as arriving from behind it. The
 * door's own contents rise a beat later (`welcome.tsx`), which makes the two
 * screens one move.
 *
 * It is also shorter than it was: about 1.3s against 2.1s. A launch that has
 * already kept somebody waiting should not then ask for two more seconds of its
 * own admiration.
 */
const WASH_MS = 360;
/** One half of the breath: the mark swells for this long, then settles for it. */
const BREATHE_MS = 240;
const HOLD_MS = 120;
const LIFT_MS = 380;
/** How far the wash drifts, as a fraction of the screen — a drift, not a swipe. */
const WASH_DRIFT = 0.12;

/**
 * The wash, light to deep through the brand colour.
 *
 * The middle stop is `SPLASH_BG` itself, so the wash is a *lean* either side of
 * the colour the field already is rather than a different colour laid over it.
 * Both ends are within a few steps of it: a launch screen that visibly changes
 * colour is a launch screen somebody will remember for the wrong reason.
 */
const WASH_COLOURS = ['#FFEE7A', SPLASH_BG, '#E0B800'] as const;

export function AnimatedSplash() {
  const [done, setDone] = useState(false);
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();

  // The whole field, and the logo riding on it.
  const fieldOpacity = useSharedValue(1);
  const fieldScale = useSharedValue(1);
  // The mark starts exactly as the native splash left it: there, and full size.
  const logoScale = useSharedValue(1);
  // The wash starts invisible, so frame one is the flat field and nothing else.
  const washOpacity = useSharedValue(0);
  const washShift = useSharedValue(0);

  const finish = useCallback(() => setDone(true), []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Hand off from the native splash to this one. This paints an identical
    // field, so hiding the native splash reveals no gap.
    SplashScreen.hideAsync().catch(() => {});

    // Both halves of the breath, then the hold: the mark has to be back at
    // rest before the field starts to leave, or the lift begins over a logo
    // still settling and the two motions read as one smear.
    const liftAt = WASH_MS + BREATHE_MS * 2 + HOLD_MS;
    const guardAt = liftAt + LIFT_MS + 600;

    if (reduceMotion) {
      // No drift, no breath, no lift: the field simply goes. A colour sliding
      // across the screen is exactly what that setting is asking us not to do.
      fieldOpacity.value = withDelay(
        liftAt,
        withTiming(0, { duration: LIFT_MS, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) runOnJS(finish)();
        }),
      );
      // Safety net: a cancelled animation never calls back, and the field would
      // stay up at zero opacity, eating every touch.
      const reducedGuard = setTimeout(finish, guardAt);
      return () => clearTimeout(reducedGuard);
    }

    washOpacity.value = withTiming(1, { duration: WASH_MS, easing: Easing.out(Easing.quad) });
    // One continuous drift across the whole life of the screen, so the field is
    // never still — a splash that pauses is the thing that reads as a freeze.
    washShift.value = withTiming(1, {
      duration: liftAt + LIFT_MS,
      easing: Easing.inOut(Easing.quad),
    });
    // One breath, and a small one: the mark is already where it belongs, so
    // this is a sign of life rather than an entrance.
    logoScale.value = withSequence(
      withDelay(
        WASH_MS,
        withTiming(1.045, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
      ),
      withTiming(1, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
    );

    // Fading and growing together: the field pulls away from the viewer's eye
    // rather than dissolving on the spot.
    fieldScale.value = withDelay(
      liftAt,
      withTiming(1.12, { duration: LIFT_MS, easing: Easing.in(Easing.cubic) }),
    );
    fieldOpacity.value = withDelay(
      liftAt,
      withTiming(0, { duration: LIFT_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(finish)();
      }),
    );
    const guard = setTimeout(finish, guardAt);
    return () => clearTimeout(guard);
  }, [finish, fieldOpacity, fieldScale, logoScale, reduceMotion, washOpacity, washShift]);

  const fieldStyle = useAnimatedStyle(() => ({
    opacity: fieldOpacity.value,
    transform: [{ scale: fieldScale.value }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));
  // The wash is drawn oversized and slid diagonally, so its edges never come
  // into view: what shows is the colour changing, not a rectangle moving.
  const washStyle = useAnimatedStyle(() => ({
    opacity: washOpacity.value,
    transform: [
      { translateX: (washShift.value - 0.5) * width * WASH_DRIFT },
      { translateY: (washShift.value - 0.5) * height * WASH_DRIFT },
    ],
  }));

  if (done || Platform.OS === 'web') return null;

  return (
    <Animated.View
      // Eats touches while it is up, so a tap never reaches the app underneath
      // mid-fade.
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, fieldStyle]}
    >
      {/* The flat field — the exact colour the native splash was drawing. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        {/* The wash, over the flat colour and under the mark. Oversized by the
            drift on every side, so sliding it never uncovers an edge. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: -width * WASH_DRIFT,
              right: -width * WASH_DRIFT,
              top: -height * WASH_DRIFT,
              bottom: -height * WASH_DRIFT,
            },
            washStyle,
          ]}
        >
          <LinearGradient
            colors={WASH_COLOURS}
            locations={[0, 0.52, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View style={logoStyle}>
          <Image
            source={MARK}
            // Square source, so one dimension is the whole instruction.
            style={{ width: MARK_WIDTH, height: MARK_WIDTH }}
            resizeMode="contain"
            // Decorative: the app's name is announced by the app, and a screen
            // reader meeting a launch screen should be told nothing it then has
            // to wait through.
            accessible={false}
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}
