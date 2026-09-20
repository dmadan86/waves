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
import * as SplashScreen from 'expo-splash-screen';
import { Image, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

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
 * The beats, in order. The native half is a still image — Android decides how
 * long it holds and nothing here can animate it — so every bit of motion this
 * launch has belongs to the half below, and it has to be worth watching or the
 * whole launch reads as frozen. That is what was reported: a mark that appeared
 * and sat there.
 *
 * Land, breathe once, lift. The mark drops in on a spring, takes one slow
 * breath so the screen is alive rather than paused, and then the whole field
 * lifts *towards* the viewer as it fades — a scale past 1, not a dissolve — so
 * the app underneath reads as arriving from behind it rather than crossfading
 * into it. The door's own contents rise a beat later (`welcome.tsx`), which
 * makes the two screens one move.
 */
const BREATHE_MS = 520;
const HOLD_MS = 240;
const LIFT_MS = 420;

export function AnimatedSplash() {
  const [done, setDone] = useState(false);

  // The whole field, and the logo riding on it.
  const fieldOpacity = useSharedValue(1);
  const fieldScale = useSharedValue(1);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.72);

  const finish = useCallback(() => setDone(true), []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Hand off from the native splash to this one. This paints an identical
    // field, so hiding the native splash reveals no gap.
    SplashScreen.hideAsync().catch(() => {});

    logoOpacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
    // A spring in, then one breath out and back. The overshoot is the part that
    // reads as motion at a glance; the breath is what stops the screen looking
    // paused while the app behind it finishes waking up.
    logoScale.value = withSequence(
      withSpring(1, { damping: 9, stiffness: 120 }),
      withTiming(1.06, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
    );

    const liftAt = 420 + BREATHE_MS * 2 + HOLD_MS;
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
    // Safety net: a cancelled animation never calls back, and the field would
    // stay up at zero opacity, eating every touch.
    const guard = setTimeout(finish, liftAt + LIFT_MS + 600);
    return () => clearTimeout(guard);
  }, [finish, fieldOpacity, fieldScale, logoOpacity, logoScale]);

  const fieldStyle = useAnimatedStyle(() => ({
    opacity: fieldOpacity.value,
    transform: [{ scale: fieldScale.value }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  if (done || Platform.OS === 'web') return null;

  return (
    <Animated.View
      // Eats touches while it is up, so a tap never reaches the app underneath
      // mid-fade.
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, fieldStyle]}
    >
      {/* The flat field, with the mark centred on it. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
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
