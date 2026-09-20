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
  withRepeat,
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
        {/* The scatter drifts behind everything — depth, not decoration you
            look at. Under the content and untouchable. */}
        <GatewayBackdrop />
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

          {/* The hero rides in the upper third: a small brand tag, the headline
              that says what the app is for, and one line under it. */}
          <View style={{ flex: 0.5 }} />
          <View
            style={{
              paddingHorizontal: theme.spacing.xxl,
              gap: theme.spacing.sm,
              alignItems: 'center',
            }}
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
          </View>
          <View style={{ flex: 1 }} />

          {/* The ways in, anchored to the bottom: the legal line, one primary
              provider, the rest as tiles, and the way back for a member. */}
          <View
            style={{
              paddingHorizontal: theme.spacing.xxl,
              paddingBottom: theme.spacing.xl,
              gap: theme.spacing.md,
            }}
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
          </View>
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
 * The field behind the door: a scatter of the app's own marks, drifting.
 *
 * It replaces three sine-wave bands on a green wash. The waves were depth for a
 * coloured field, and the field is no longer coloured — this door is light now,
 * the way Family's is, because a white ground lets the headline be the loudest
 * thing on the screen and a green one never can.
 *
 * What is scattered is not confetti: every glyph is a thing the app is for — a
 * receipt, a plane, a bowl, a house — in the six tints the rest of the app
 * already dresses its categories in. So the first screen says what the app does
 * twice, once in the headline and once in the objects around it.
 *
 * Each mark bobs on its own clock, slowly and by a few points, out of phase
 * with its neighbours, which is what keeps a still image from looking like a
 * still image. Motion-gated: with animation turned off the scatter is drawn and
 * holds, because the arrangement is the picture and only the drift is decoration.
 */
const SCATTER = [
  { icon: 'receipt-outline', tint: 'peach', x: 0.1, y: 0.06, size: 56, seconds: 7 },
  { icon: 'airplane-outline', tint: 'sky', x: 0.74, y: 0.04, size: 64, seconds: 9 },
  { icon: 'fast-food-outline', tint: 'coral', x: 0.42, y: 0.15, size: 48, seconds: 8 },
  { icon: 'home-outline', tint: 'mint', x: 0.08, y: 0.34, size: 60, seconds: 11 },
  { icon: 'cafe-outline', tint: 'lilac', x: 0.8, y: 0.3, size: 52, seconds: 6 },
  { icon: 'card-outline', tint: 'pink', x: 0.52, y: 0.42, size: 58, seconds: 10 },
  { icon: 'people-outline', tint: 'sky', x: 0.18, y: 0.55, size: 50, seconds: 8 },
  { icon: 'car-outline', tint: 'peach', x: 0.78, y: 0.56, size: 46, seconds: 12 },
] as const satisfies readonly {
  icon: keyof typeof Ionicons.glyphMap;
  tint: TintName;
  /** Where the mark sits, as a fraction of the field it is given. */
  x: number;
  y: number;
  /** The disc's diameter. The glyph inside is drawn at 45% of it. */
  size: number;
  /** One full bob, up and back. */
  seconds: number;
}[];

/** How far a mark travels on its bob. Small enough to read as breathing. */
const DRIFT = 10;

function GatewayBackdrop() {
  const reduceMotion = useReducedMotion();

  return (
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {SCATTER.map((mark) => (
        <ScatterMark key={mark.icon} mark={mark} still={reduceMotion} />
      ))}
    </View>
  );
}

function ScatterMark({
  mark,
  still,
}: {
  mark: (typeof SCATTER)[number];
  still: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    // Reversed rather than restarted, so a mark rises and sinks on one path
    // instead of snapping back to where it began.
    bob.value = withRepeat(
      withTiming(1, { duration: mark.seconds * 1000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(bob);
  }, [bob, mark.seconds, still]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -DRIFT * bob.value }],
  }));

  const tint = theme.tint[mark.tint];

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          // Percentages rather than measured points: the field is whatever the
          // screen gives it, and the arrangement should hold on a small phone
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
