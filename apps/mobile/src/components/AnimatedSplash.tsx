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
  withTiming,
} from 'react-native-reanimated';

/** The field. Kept identical to `expo-splash-screen`'s `backgroundColor` in
    `app.json`, because the native splash is this same flat colour and this one
    is painted over it — any difference shows as a flash at the handoff. */
const SPLASH_BG = '#6C4EE3';

/** The mark's drawn width, identical to `imageWidth` in `app.json` for the same
    reason: the native half draws the same file, and a mark that changes size
    mid-launch is the seam in another form. */
const MARK_WIDTH = 140;

/** The mark in white, so it reads on the brand field. Same file the native
    splash is given. */
const MARK = require('../../assets/images/splash-mark-white.png');

export function AnimatedSplash() {
  const [done, setDone] = useState(false);

  // The whole field, and the logo riding on it.
  const fieldOpacity = useSharedValue(1);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.82);

  const finish = useCallback(() => setDone(true), []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Hand off from the native splash to this one. This paints an identical
    // field, so hiding the native splash reveals no gap.
    SplashScreen.hideAsync().catch(() => {});

    logoOpacity.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) });
    logoScale.value = withSequence(
      withTiming(1.06, { duration: 460, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 160, easing: Easing.inOut(Easing.quad) }),
    );
    // Hold the settled logo, then lift the whole field to reveal the app.
    fieldOpacity.value = withDelay(
      920,
      withTiming(0, { duration: 360, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(finish)();
      }),
    );
    // Safety net: a cancelled animation never calls back, and the field would
    // stay up at zero opacity, eating every touch.
    const guard = setTimeout(finish, 2000);
    return () => clearTimeout(guard);
  }, [finish, fieldOpacity, logoOpacity, logoScale]);

  const fieldStyle = useAnimatedStyle(() => ({ opacity: fieldOpacity.value }));
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
