/**
 * The animated splash — the bridge between the OS splash and the app.
 *
 * The launch has two splashes back to back, and the seam between them is meant
 * to be invisible. First the native one (a bare `SPLASH_BG` field, configured
 * in `app.json`'s `expo-splash-screen`) shows the instant the process starts,
 * while the JS is still loading. Then this component mounts, hides the native
 * splash, and paints an identical field on top — same colour, nothing on it —
 * so nothing flickers at the handoff. From there it plays: the mark draws
 * itself on, holds a beat, and the whole field lifts away to reveal the app
 * underneath.
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
 * The mark is no longer in the native half at all. It is drawn on here —
 * the stroke inking itself in, the dot landing, then a swell of weight
 * travelling back through it (`WaveMark`) — and a logo cannot arrive if the
 * launch has already spent a second showing it finished. So `app.json` gives
 * `expo-splash-screen` a colour and no image, and the two halves share only
 * the field. The seam is a flat colour meeting the same flat colour, which
 * is the one handoff that cannot show.
 *
 * The cost, stated plainly: on a slow cold start the launch is bare yellow
 * for as long as the JS takes to come up. Putting a mark back in `app.json`
 * buys that back and breaks the arrival — the two cannot both be had.
 *
 * To rebrand: `SPLASH_BG` here and `backgroundColor` in `app.json` are the
 * same colour and must move together. To change the mark itself, edit
 * `assets/brand/wave-mark.json` and re-run `infra/art/render-splash-mark.py`.
 */
import { useCallback, useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/reducedMotion';
import { WaveMark } from '@/components/WaveMark';

/** The field. Kept identical to `expo-splash-screen`'s `backgroundColor` in
    `app.json`, because the native splash is this same flat colour and this one
    is painted over it — any difference shows as a flash at the handoff.

    Yellow, and deliberately not one of the app's own colours: a launch screen
    is the one surface whose job is to be recognised across a home screen full
    of apps, which is what GoodRx's yellow and Spotify's black are for. The mark
    on it is the app's ink rather than white, because a white mark on this is
    unreadable. */
const SPLASH_BG = '#F5D800';

/** The mark's drawn width. The native half no longer draws a mark, so this is
    the only place it is sized. */
const MARK_WIDTH = 140;

/**
 * The beats, in order.
 *
 * The rule that shapes all of them: **this half opens on the frame the native
 * half ended on.** The native splash is now a bare `SPLASH_BG` field, held for
 * as long as Android takes to start the JS. So the first frame drawn here is
 * that same bare field, and everything on it arrives afterwards.
 *
 * An older version faded the mark up and sprang it in from 0.72 while the
 * native half had been showing it static and full-size, which read as the logo
 * flinching: it shrank, dimmed and bounced, all after having already arrived.
 * The fix is not easing, it is removing the contradiction — either the mark is
 * already there and must not re-enter, or it is not there yet and may arrive.
 * This screen now takes the second option.
 *
 * The field moves too. A slow diagonal wash comes up over the flat yellow — a
 * lighter yellow, through the brand colour, to a deeper amber — and drifts
 * across underneath the mark as it arrives. The wash starts at zero
 * opacity, which is the flat native colour exactly, so there is still nothing
 * to see at the seam; only from the second frame on does the screen begin to
 * move.
 *
 * Then the whole field lifts *towards* the viewer as it fades — a scale past 1,
 * not a dissolve — so the app underneath reads as arriving from behind it. The
 * door's own contents rise a beat later (`welcome.tsx`), which makes the two
 * screens one move.
 *
 * The whole thing runs about 1.7s. That is longer than the 1.3s it was, and the
 * extra is bought deliberately: a mark that draws itself needs time to be read
 * as drawing rather than as flickering. It is still well under the 2.1s the
 * screen cost before either was true.
 */
const WASH_MS = 360;
/** How long the mark takes to arrive: the stroke drawing itself, the dot
    landing on it, a beat, then a swell of weight travelling back through it.
    `WaveMark` owns where each beat falls inside this; here it is one span. */
const MARK_MS = 1180;
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
  // The mark starts undrawn, which is what the native half is now showing:
  // the bare field, no logo on it.
  const markWave = useSharedValue(0);
  // The wash starts invisible, so frame one is the flat field and nothing else.
  const washOpacity = useSharedValue(0);
  const washShift = useSharedValue(0);

  const finish = useCallback(() => setDone(true), []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // Hand off from the native splash to this one. This paints an identical
    // field, so hiding the native splash reveals no gap.
    SplashScreen.hideAsync().catch(() => {});

    // The whole arrival, then the hold: the mark has to be finished before
    // the field starts to leave, or the lift begins over a logo still
    // drawing and the two motions read as one smear.
    const liftAt = MARK_MS + HOLD_MS;
    const guardAt = liftAt + LIFT_MS + 600;

    if (reduceMotion) {
      // The mark is drawn by the animation now, so with the animation off it
      // has to be placed rather than skipped — otherwise this setting gets a
      // bare yellow field and no logo at all. Straight to finished, no motion.
      markWave.value = 1;
      // No drift, no draw-on, no lift: the field simply goes. A colour sliding
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
    // The mark draws itself on. Linear, because the shaping lives inside
    // `WaveMark` where each beat can be eased on its own terms; easing the
    // whole span would warp the gaps between them.
    markWave.value = withTiming(1, { duration: MARK_MS, easing: Easing.linear });

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
  }, [finish, fieldOpacity, fieldScale, markWave, reduceMotion, washOpacity, washShift]);

  const fieldStyle = useAnimatedStyle(() => ({
    opacity: fieldOpacity.value,
    transform: [{ scale: fieldScale.value }],
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

        {/* Decorative: the app's name is announced by the app, and a screen
            reader meeting a launch screen should be told nothing it then has
            to wait through. */}
        <View accessible={false}>
          <WaveMark size={MARK_WIDTH} progress={markWave} />
        </View>
      </View>
    </Animated.View>
  );
}
