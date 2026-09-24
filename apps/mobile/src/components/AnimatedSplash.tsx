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
 * The cost, stated plainly: on a slow cold start the launch is a bare purple
 * field for as long as the JS takes to come up. Putting a mark back in
 * `app.json` buys that back and breaks the arrival — the two cannot both be
 * had.
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
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useLaunchReady } from '@/lib/launchReady';
import { useReducedMotion } from '@/lib/reducedMotion';
import { MARK_DRAWN, WaveMark } from '@/components/WaveMark';

/** The field. Kept identical to `expo-splash-screen`'s `backgroundColor` in
    `app.json`, because the native splash is this same flat colour and this one
    is painted over it — any difference shows as a flash at the handoff.

    The brand purple, `brand600` in `tokens.ts`, and the mark on it is white.
    This replaced a yellow field carrying the ink-dark mark. The argument for
    the yellow was recognition across a crowded home screen; the argument
    against it, which won, is that the launch then opens on a colour the app
    itself never uses again — the header you land on, every brand surface
    behind it, and the icon in the launcher are all this purple. A launch
    screen that is the app's own colour is the one the app can keep. */
const SPLASH_BG = '#6C4EE3';

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
 * The field moves too. A slow diagonal wash comes up over the flat purple — a
 * step lighter, through the brand colour, to a step deeper — and drifts
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
 * The whole thing runs about 1.25s, down from 1.7s: launch is asked to feel
 * instant, and the draw still reads as drawing at this pace. It is a floor, not
 * a fixed length — the field holds (still drifting) until the first real screen
 * says it is ready, up to `MAX_WAIT_MS`, so it never lifts onto a spinner.
 */
const WASH_MS = 360;
/** How long the mark takes to arrive: the stroke drawing itself, the dot
    landing on it, a beat, then a swell of weight travelling back through it.
    `WaveMark` owns where each beat falls inside this; here it is one span. */
const MARK_MS = 900;
const HOLD_MS = 60;
const LIFT_MS = 300;
/**
 * Whether the native half has already drawn the mark. On Android 12 and later
 * the OS splash plays an animated vector of the stroke inking on and the dot
 * landing, from the first frame of the process (plugins/withAnimatedSplashMark.js),
 * so this half opens on the finished mark and plays only what is left: the
 * swell, then the lift. Earlier Android shows that drawable's first frame, an
 * undrawn mark, and this half draws the whole thing as before.
 */
const NATIVE_DRAWS_MARK =
  Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 31;

/** Where the mark starts in this half: finished if the native half drew it. */
const MARK_START = NATIVE_DRAWS_MARK ? MARK_DRAWN : 0;

/** The longest the splash waits on a screen that has not said it is ready. */
const MAX_WAIT_MS = 5000;
/** How far the wash drifts, as a fraction of the screen — a drift, not a swipe. */
const WASH_DRIFT = 0.12;

/**
 * The wash, light to deep through the brand colour.
 *
 * The middle stop is `SPLASH_BG` itself, so the wash is a *lean* either side of
 * the colour the field already is rather than a different colour laid over it.
 * Both ends are one step of the brand ramp away — `brand500` and `brand700` —
 * because a launch screen that visibly changes colour is a launch screen
 * somebody will remember for the wrong reason.
 */
const WASH_COLOURS = ['#7A5AF8', SPLASH_BG, '#5638C4'] as const;

export function AnimatedSplash() {
  const [done, setDone] = useState(false);
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();

  // The whole field, and the logo riding on it.
  const fieldOpacity = useSharedValue(1);
  const fieldScale = useSharedValue(1);
  // The mark starts where the native half left it: finished on Android 12+,
  // undrawn (a bare field) everywhere else. Either way frame one is the frame
  // the OS splash ended on, so the handoff cannot show.
  const markWave = useSharedValue(MARK_START);
  // The wash starts invisible, so frame one is the flat field and nothing else.
  const washOpacity = useSharedValue(0);
  const washShift = useSharedValue(0);

  const finish = useCallback(() => {
    // The component stays mounted (rendering nothing) once the field is gone,
    // so the effect that started the endless drift never cleans up on its own.
    // Stop it here, or it runs on the UI thread for the life of the process.
    cancelAnimation(washShift);
    cancelAnimation(washOpacity);
    cancelAnimation(markWave);
    setDone(true);
  }, [markWave, washOpacity, washShift]);

  // The splash leaves when two things are true: the mark has finished
  // arriving, and the first real screen is ready underneath it. It used to
  // leave on the clock alone, and when sign-in was still being settled that
  // revealed a white screen with a spinner before the app — the one moment of
  // the launch that looked broken. Now it simply stays a beat longer instead.
  const appReady = useLaunchReady();
  const [drawn, setDrawn] = useState(false);
  // A screen that never says it is ready must not trap the launch behind a
  // purple field for ever: past this the splash goes regardless.
  const [waitedEnough, setWaitedEnough] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    // The whole arrival, then the hold: the mark has to be finished before
    // the field starts to leave, or the lift begins over a logo still
    // drawing and the two motions read as one smear.
    // Only what is left of the mark: all of it, or just the swell when the
    // native half has already drawn the rest.
    const markMs = MARK_MS * (1 - MARK_START);
    const liftAt = markMs + HOLD_MS;

    let cancelled = false;
    let drawnTimer: ReturnType<typeof setTimeout> | undefined;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;

    const begin = () => {
      if (cancelled) return;
      drawnTimer = setTimeout(() => setDrawn(true), reduceMotion ? 0 : liftAt);
      waitTimer = setTimeout(() => setWaitedEnough(true), MAX_WAIT_MS);

      if (reduceMotion) {
        // The mark is drawn by the animation now, so with the animation off it
        // has to be placed rather than skipped — otherwise this setting gets a
        // bare purple field and no logo at all. Straight to finished, no motion.
        markWave.value = 1;
        // `reduceMotion` is a dependency of this effect, so it can turn on
        // while the screen is already moving. Put the field back where the
        // motionless version expects to find it: a wash left half-faded, or a
        // drift left mid-way, would otherwise carry on from wherever the
        // animation it replaced had got to. (The field's scale only moves in
        // the lift, which has not started while this runs.)
        washOpacity.value = 0;
        washShift.value = 0;
        return;
      }

      washOpacity.value = withTiming(1, { duration: WASH_MS, easing: Easing.out(Easing.quad) });
      // One continuous drift, back and forth for as long as the screen is up,
      // so the field is never still — a splash that pauses is the thing that
      // reads as a freeze, and it may now be up a beat longer than the mark.
      washShift.value = withRepeat(
        withTiming(1, { duration: liftAt + LIFT_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
      // The mark draws itself on. Linear, because the shaping lives inside
      // `WaveMark` where each beat can be eased on its own terms; easing the
      // whole span would warp the gaps between them.
      markWave.value = withTiming(1, { duration: markMs, easing: Easing.linear });
    };

    // Nothing starts until the native splash is actually off the screen.
    //
    // It used to start on mount, and on a real device that threw the whole
    // arrival away: the native window sits on top until `hideAsync` resolves,
    // so the stroke drew itself, the dot landed and the swell ran through —
    // all of it underneath an opaque field nobody could see. What the phone
    // showed was the mark already finished, static, for a second and a half.
    // The animation was never broken; it was just playing to an empty room.
    //
    // Either arm starts it: if hiding fails there is no native splash left to
    // wait for, and a rejected promise must not cost the app its splash.
    SplashScreen.hideAsync().then(begin, begin);

    return () => {
      cancelled = true;
      if (drawnTimer) clearTimeout(drawnTimer);
      if (waitTimer) clearTimeout(waitTimer);
      // Stop every animation this effect started. Without this a re-run — which
      // `reduceMotion` can cause at any point — leaves the previous pass still
      // driving the same shared values, and the two fight over the screen.
      cancelAnimation(markWave);
      cancelAnimation(washOpacity);
      cancelAnimation(washShift);
    };
  }, [markWave, reduceMotion, washOpacity, washShift]);

  const leaving = drawn && (appReady || waitedEnough);

  useEffect(() => {
    if (!leaving || Platform.OS === 'web') return;

    const done = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(finish)();
    };
    if (reduceMotion) {
      // No drift, no draw-on, no lift: the field simply goes. A colour sliding
      // across the screen is exactly what that setting is asking us not to do.
      fieldOpacity.value = withTiming(
        0,
        { duration: LIFT_MS, easing: Easing.out(Easing.quad) },
        done,
      );
    } else {
      // Fading and growing together: the field pulls away from the viewer's eye
      // rather than dissolving on the spot.
      fieldScale.value = withTiming(1.12, { duration: LIFT_MS, easing: Easing.in(Easing.cubic) });
      fieldOpacity.value = withTiming(
        0,
        { duration: LIFT_MS, easing: Easing.in(Easing.cubic) },
        done,
      );
    }
    // Safety net: a cancelled animation never calls back, and the field would
    // stay up at zero opacity, eating every touch.
    const guard = setTimeout(finish, LIFT_MS + 600);
    return () => {
      clearTimeout(guard);
      cancelAnimation(fieldOpacity);
      cancelAnimation(fieldScale);
    };
  }, [leaving, finish, fieldOpacity, fieldScale, reduceMotion]);

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
