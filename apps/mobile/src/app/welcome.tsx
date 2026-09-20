/**
 * The door — the first screen after the splash for a signed-out person.
 *
 * It used to be a gateway: a wordmark on the green, and two buttons that only
 * asked which errand you were on ("Create account" / "Sign in"), both of which
 * landed you on a form. That is one screen of nothing before anything can
 * happen. This is the Headway shape instead — a headline saying what the app
 * is, then the ways in themselves, right here: one primary provider button
 * (Apple on iOS, Google elsewhere), the rest as a row of tiles beneath it, and
 * a Skip pill in the header for the guest way in (ADR-006 — nobody registers
 * before they can split a bill; Skip is now where that lives).
 *
 * Tapping Google or Apple signs in from this screen. The sign-up form is not
 * gone, it has simply moved behind the email tile, which is where a form
 * belongs: one of several ways in, not the toll gate in front of all of them.
 *
 * The language globe still sits in the header whenever there is no back
 * chevron, so somebody who opened the app in a script they cannot read can
 * change it from the first frame.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Callout, directionalIcon, iconSize, Row, Text, useTheme, type TintName } from '@waves/ui';

import { LegalLine } from '@/components/LegalLine';
import { ProviderButton, SocialTile } from '@/components/SocialTile';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { phoneSignInAvailable } from '@/lib/phoneAuth';

/** How long after mount the words start arriving. The scatter is already
    landing by then, so the two overlap rather than queue. */
const START_MS = 140;

/** How far the headline and the ways in travel as they arrive. Enough to read
    as a rise, small enough that nothing is ever far from where it lands. */
const RISE = 14;

/** The Skip pill's face on the light field: the brand at its softest, which
    reads as a control without becoming a second button competing with the
    provider below. */
const SKIP_FACE = 'brandSoft' as const;

export default function WelcomeScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const { withGoogle, withApple } = useAuth();
  const canGoBack = router.canGoBack();

  // The same busy/error pair the auth sheet keeps: one provider round-trip at a
  // time, and whatever comes back said in words rather than in the SDK's.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reduceMotion = useReducedMotion();

  // The door composes itself: the scatter lands first (each mark on its own
  // delay, inside `ScatterBand`), then the headline rises under it, then the
  // ways in. The order is the reading order, a third of a second apart, so the
  // screen arrives the way somebody reads it rather than all at once. The
  // splash's own field lifts just before this, so the two read as one move.
  const heroIn = useSharedValue(reduceMotion ? 1 : 0);
  const waysIn = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) return;
    const rise = (delay: number) =>
      withDelay(delay, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    heroIn.value = rise(START_MS);
    waysIn.value = rise(START_MS + 120);
  }, [heroIn, reduceMotion, waysIn]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroIn.value,
    transform: [{ translateY: (1 - heroIn.value) * RISE }],
  }));
  const waysStyle = useAnimatedStyle(() => ({
    opacity: waysIn.value,
    transform: [{ translateY: (1 - waysIn.value) * RISE }],
  }));

  const run = (action: () => Promise<unknown>): void => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(
          friendlyError(
            caught,
            t.signIn.couldNotSignIn,
            'auth.signIn',
            t.misc.connectionProblem,
            t.misc.tooManyTries,
          ),
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  // Apple leads on iOS — its guidelines want it at least as prominent as the
  // alternatives, and App Store guideline 4.8 requires it beside Google there.
  // Google leads everywhere else, where Apple is only a browser fallback.
  const appleFirst = Platform.OS === 'ios';

  const googleTile = (
    <SocialTile
      key="google"
      testID="auth-google"
      provider="google"
      field="surface"
      accessibilityLabel={t.signIn.continueGoogle}
      caption={t.signIn.providerGoogle}
      disabled={busy}
      onPress={() => run(withGoogle)}
    />
  );
  const appleTile = (
    <SocialTile
      key="apple"
      testID="auth-apple"
      provider="apple"
      field="surface"
      accessibilityLabel={t.signIn.continueApple}
      caption={t.signIn.providerApple}
      disabled={busy}
      onPress={() => run(withApple)}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      {/* A light field, not a coloured one. The door used to be a green wash
          with white type on it, which makes every word on the screen shout at
          the same volume; on white the headline is the loudest thing and the
          ways in sit quietly under it, which is the order somebody meeting the
          app needs them in. */}
      <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          {/* The header: back when there is somewhere to go back to, otherwise
              the language globe; and Skip, which is the guest way in. */}
          <Row
            style={{
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: theme.spacing.sm,
            }}
          >
            {canGoBack ? (
              <HeaderGlyph
                label={t.common.back}
                icon={directionalIcon('chevron-back')}
                onPress={() => router.back()}
              />
            ) : (
              <HeaderGlyph
                label={t.language}
                icon="globe-outline"
                onPress={() => router.push('/language')}
              />
            )}
            <Pressable
              testID="welcome-skip"
              accessibilityRole="button"
              accessibilityLabel={t.common.skip}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => router.push('/guest-welcome')}
              hitSlop={8}
              style={({ pressed }) => ({
                height: 44,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color[SKIP_FACE],
                alignItems: 'center',
                justifyContent: 'center',
                opacity: busy ? 0.45 : pressed ? 0.7 : 1,
              })}
            >
              <Text variant="subheading" tone="brand" style={{ fontWeight: '700' }}>
                {t.common.skip}
              </Text>
            </Pressable>
          </Row>

          {/* The scatter has a band of its own between the header and the
              headline, and is clipped to it. It used to be an absolute field
              behind the whole screen, which put a house over "No account needed
              to start" and a card through the middle of the body copy — a
              backdrop you cannot read the page through is not a backdrop. Given
              its own box it cannot reach the words, and the page keeps the shape
              the reference has: the picture above, everything you read below. */}
          <ScatterBand still={reduceMotion} />

          {/* The hero: a small brand tag, the headline that says what the app is
              for, and one line under it. It rises into place once the scatter is
              in, so the screen composes itself rather than appearing whole. */}
          <Animated.View
            style={[
              {
                paddingHorizontal: theme.spacing.xxl,
                gap: theme.spacing.sm,
                alignItems: 'center',
              },
              heroStyle,
            ]}
          >
            <Text variant="subheading" tone="brand" style={{ fontWeight: '800' }}>
              {t.common.appName}
            </Text>
            {/* Centred, and the string already carries its own line break, so
                the two lines break where they were written to break rather than
                wherever the width runs out. */}
            <Text
              style={{
                fontSize: 38,
                lineHeight: 44,
                fontWeight: '800',
                letterSpacing: -1,
                textAlign: 'center',
                color: theme.color.text,
              }}
            >
              {t.signIn.splitAnything}
            </Text>
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {t.signIn.welcomeBody}
            </Text>
          </Animated.View>
          <View style={{ flex: 1 }} />

          {/* The ways in, anchored to the bottom: the legal line, one primary
              provider, the rest as tiles, and the way back for a member. */}
          <Animated.View
            style={[
              {
                paddingHorizontal: theme.spacing.xxl,
                paddingBottom: theme.spacing.xl,
                gap: theme.spacing.md,
              },
              waysStyle,
            ]}
          >
            {error ? <Callout tone="negative">{error}</Callout> : null}

            <LegalLine
              textStyle={{
                color: theme.color.textMuted,
                lineHeight: 20,
                marginBottom: theme.spacing.xs,
              }}
            />

            <ProviderButton
              testID="welcome-provider"
              provider={appleFirst ? 'apple' : 'google'}
              label={appleFirst ? t.signIn.continueApple : t.signIn.continueGoogle}
              disabled={busy}
              onPress={() => run(appleFirst ? withApple : withGoogle)}
            />

            <Row
              style={{
                justifyContent: 'center',
                gap: theme.spacing.xxl,
                marginTop: theme.spacing.sm,
              }}
            >
              {appleFirst ? googleTile : appleTile}
              {/* Only where the build can actually do it. Firebase sends the
                  code and Firebase is a native module, so a JavaScript-only
                  update landing on a binary made before it existed would draw
                  this tile over nothing — a door offered and then dead under the
                  finger, which is worse than no door. */}
              {phoneSignInAvailable() ? (
                <SocialTile
                  testID="auth-phone"
                  provider="phone"
                  field="surface"
                  accessibilityLabel={t.signIn.continuePhone}
                  caption={t.signIn.providerPhone}
                  disabled={busy}
                  onPress={() => router.push('/phone')}
                />
              ) : null}
              <SocialTile
                testID="auth-email"
                provider="email"
                field="surface"
                accessibilityLabel={t.signIn.continueEmail}
                caption={t.signIn.providerEmail}
                disabled={busy}
                onPress={() => router.push('/sign-up')}
              />
            </Row>

            <Row
              style={{
                justifyContent: 'center',
                alignItems: 'center',
                gap: theme.spacing.xs,
                marginTop: theme.spacing.sm,
              }}
            >
              <Text variant="body" tone="muted">
                {t.signIn.haveAccountPrompt}
              </Text>
              <Pressable
                testID="welcome-sign-in"
                accessibilityRole="button"
                accessibilityLabel={t.signIn.signInAction}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => router.push('/sign-in')}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
                  {t.signIn.signInAction}
                </Text>
              </Pressable>
            </Row>
          </Animated.View>
        </SafeAreaView>
      </View>
    </View>
  );
}

/** A 44pt header glyph on the brand field — back, or the language globe. */
function HeaderGlyph({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.text} />
    </Pressable>
  );
}

/**
 * The band above the headline: a scatter of the app's own marks, landing and
 * then drifting.
 *
 * It replaced three sine-wave bands on a green wash — waves were depth for a
 * coloured field, and this door is light now. What is scattered is not
 * confetti: every glyph is a thing the app is for, a receipt, a plane, a bowl,
 * a house, in the six tints the rest of the app dresses its categories in. So
 * the first screen says what the app does twice, once in the headline and once
 * in the objects above it.
 *
 * **It lives in a box of its own, and that is the point.** As a backdrop behind
 * the whole screen it put a house through "No account needed to start" and a
 * card through the body copy: a backdrop you cannot read the page through is
 * not a backdrop. Bounded, it cannot reach the words, and the page keeps the
 * shape the reference has — the picture above, everything you read below.
 *
 * Each mark drops in on its own delay, a twelfth of a second apart, then bobs
 * on its own slow clock so the arrangement breathes without becoming something
 * to watch. Motion-gated: with animation off every mark is simply there, in
 * place, because the arrangement is the picture and only the movement is
 * decoration.
 */
const SCATTER = [
  { icon: 'receipt-outline', tint: 'peach', x: 0.06, y: 0.1, size: 54, seconds: 7 },
  { icon: 'airplane-outline', tint: 'sky', x: 0.76, y: 0.04, size: 60, seconds: 9 },
  { icon: 'fast-food-outline', tint: 'coral', x: 0.4, y: 0.0, size: 46, seconds: 8 },
  { icon: 'home-outline', tint: 'mint', x: 0.2, y: 0.52, size: 50, seconds: 11 },
  { icon: 'cafe-outline', tint: 'lilac', x: 0.62, y: 0.45, size: 44, seconds: 6 },
  { icon: 'card-outline', tint: 'pink', x: 0.86, y: 0.58, size: 42, seconds: 10 },
] as const satisfies readonly {
  icon: keyof typeof Ionicons.glyphMap;
  tint: TintName;
  /** Where the mark sits, as a fraction of the band it is given. */
  x: number;
  y: number;
  /** The disc's diameter. The glyph inside is drawn at 45% of it. */
  size: number;
  /** One full bob, up and back. */
  seconds: number;
}[];

/** How far a mark travels on its bob. Small enough to read as breathing. */
const DRIFT = 10;

/** Between one mark landing and the next. A twelfth of a second reads as a
    scatter arriving rather than as six separate events. */
const STAGGER_MS = 80;

/**
 * The band's height. It is `flex: 1` inside the column, so it takes whatever is
 * left between the header and the headline and never pushes either off; this
 * floor keeps the scatter from collapsing to nothing on a short screen, where
 * it would read as a rendering fault rather than as a smaller picture.
 */
const BAND_MIN_HEIGHT = 150;

function ScatterBand({ still }: { still: boolean }): React.JSX.Element {
  return (
    <View pointerEvents="none" style={{ flex: 1, minHeight: BAND_MIN_HEIGHT, overflow: 'hidden' }}>
      {SCATTER.map((mark, index) => (
        <ScatterMark key={mark.icon} mark={mark} index={index} still={still} />
      ))}
    </View>
  );
}

function ScatterMark({
  mark,
  index,
  still,
}: {
  mark: (typeof SCATTER)[number];
  index: number;
  still: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const land = useSharedValue(still ? 1 : 0);
  const bob = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    // A spring rather than a curve: a mark that overshoots a little and settles
    // reads as dropped into place, which is the whole difference between a
    // scatter arriving and a layer being faded up.
    land.value = withDelay(index * STAGGER_MS, withSpring(1, { damping: 11, stiffness: 140 }));
    // The drift starts only once the scatter has landed, so the two motions are
    // never on screen at the same time and neither muddles the other.
    bob.value = withDelay(
      SCATTER.length * STAGGER_MS + 400,
      withRepeat(
        // Reversed rather than restarted, so a mark rises and sinks on one path
        // instead of snapping back to where it began.
        withTiming(1, { duration: mark.seconds * 1000, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(land);
      cancelAnimation(bob);
    };
  }, [bob, index, land, mark.seconds, still]);

  const style = useAnimatedStyle(() => ({
    opacity: land.value,
    transform: [{ translateY: -DRIFT * bob.value }, { scale: 0.6 + 0.4 * land.value }],
  }));

  const tint = theme.tint[mark.tint];

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          // Percentages rather than measured points: the band is whatever the
          // screen leaves it, and the arrangement should hold on a small phone
          // and a tablet without either measuring or a second table of numbers.
          left: `${mark.x * 100}%`,
          top: `${mark.y * 100}%`,
          width: mark.size,
          height: mark.size,
          borderRadius: mark.size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint.bg,
        },
        style,
      ]}
    >
      <Ionicons name={mark.icon} size={Math.round(mark.size * 0.45)} color={tint.ink} />
    </Animated.View>
  );
}
