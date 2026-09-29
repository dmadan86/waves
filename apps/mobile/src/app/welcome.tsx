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
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Callout, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { LegalLine } from '@/components/LegalLine';
import { AppleMark, GoogleMark } from '@/components/SocialTile';
import { LANGUAGE_NAMES, useStrings } from '@/i18n';
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
/** The door's own light palette: a front-of-house screen, the same in every
    theme, drawn to sit on the picture. */
const INK = '#16163A';
const MUTED = '#5C6078';
const ACCENT = '#6A45E8';
const LINE = '#E6E4F0';
const SHEET = '#F8F7FC';

export default function WelcomeScreen() {
  const theme = useTheme();
  const { t, language } = useStrings();
  const { withGoogle, withApple } = useAuth();
  const { height: screenHeight } = useWindowDimensions();
  // The picture fills the top of the screen down past where the sheet begins,
  // so the sheet's rounded corners sit on it.
  const heroHeight = Math.round(screenHeight * 0.62);
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

  const signInWith = (provider: 'google' | 'apple') =>
    run(provider === 'apple' ? withApple : withGoogle);
  const first: 'google' | 'apple' = appleFirst ? 'apple' : 'google';
  const second: 'google' | 'apple' = appleFirst ? 'google' : 'apple';
  const labelFor = (provider: 'google' | 'apple') =>
    provider === 'apple' ? t.signIn.continueApple : t.signIn.continueGoogle;

  return (
    <View style={{ flex: 1, backgroundColor: SHEET }}>
      {/* The picture: the top of the screen, under the header and the words.
          A warm evening wash until the scene itself is dropped in. */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: heroHeight }}>
        <LinearGradient
          colors={['#FFF6EC', '#FBE3CC', '#F4C9A6', '#E9B38E']}
          locations={[0, 0.35, 0.75, 1]}
          style={{ flex: 1 }}
        />
        {/* A light veil top-left, so the headline always reads. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.9, y: 0.7 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* The header: back when there is somewhere to go back to, otherwise
            the language; and Skip, which is the guest way in. */}
        <Row
          style={{
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          {canGoBack ? (
            <HeaderGlyph
              label={t.common.back}
              icon={directionalIcon('chevron-back')}
              onPress={() => router.back()}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.language}
              onPress={() => router.push('/language')}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 40,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="globe-outline" size={20} color={INK} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: INK }}>
                {LANGUAGE_NAMES[language].own}
              </Text>
              <Ionicons name="chevron-down" size={16} color={INK} />
            </Pressable>
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
              height: 40,
              paddingHorizontal: 16,
              borderRadius: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(255,255,255,0.8)',
              opacity: busy ? 0.45 : pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: INK }}>{t.common.skip}</Text>
            <Ionicons name={directionalIcon('arrow-forward')} size={18} color={INK} />
          </Pressable>
        </Row>

        {/* The words, over the top of the picture, rising into place. */}
        <Animated.View
          style={[{ paddingHorizontal: theme.spacing.xl, paddingTop: 12, gap: 8 }, heroStyle]}
        >
          <Text
            style={{
              fontSize: 40,
              lineHeight: 46,
              fontWeight: '800',
              fontStyle: 'italic',
              color: ACCENT,
              letterSpacing: -0.5,
            }}
          >
            {t.common.appName}
          </Text>
          <Text
            style={{
              fontSize: 34,
              lineHeight: 40,
              fontWeight: '800',
              color: INK,
              letterSpacing: -0.8,
            }}
          >
            {t.signIn.splitAnything}
          </Text>
          <Text style={{ fontSize: 16, lineHeight: 23, color: MUTED, maxWidth: 320 }}>
            {t.signIn.heroTagline}
          </Text>
        </Animated.View>
        <View style={{ flex: 1 }} />

        {/* The ways in, on a white sheet that rises over the picture's foot. */}
        <Animated.View
          style={[
            {
              backgroundColor: SHEET,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              paddingHorizontal: theme.spacing.xl,
              paddingTop: 22,
              paddingBottom: theme.spacing.md,
              gap: 12,
            },
            waysStyle,
          ]}
        >
          {error ? <Callout tone="negative">{error}</Callout> : null}

          <Pressable
            testID="welcome-provider"
            accessibilityRole="button"
            accessibilityLabel={labelFor(first)}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => signInWith(first)}
            style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.9 : 1 })}
          >
            <LinearGradient
              colors={['#5B6CF5', '#7A5CF5', '#8E5CF0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={providerRow}
            >
              <View style={markDisc}>
                {first === 'apple' ? <AppleMark size={22} /> : <GoogleMark size={22} />}
              </View>
              <Text
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 17,
                  fontWeight: '700',
                  color: '#FFFFFF',
                }}
              >
                {labelFor(first)}
              </Text>
              <Ionicons name={directionalIcon('chevron-forward')} size={20} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>

          <Pressable
            testID={`auth-${second}`}
            accessibilityRole="button"
            accessibilityLabel={labelFor(second)}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => signInWith(second)}
            style={({ pressed }) => [
              providerRow,
              {
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: LINE,
                opacity: busy ? 0.5 : pressed ? 0.9 : 1,
              },
            ]}
          >
            <View style={[markDisc, { backgroundColor: 'transparent' }]}>
              {second === 'apple' ? <AppleMark size={24} /> : <GoogleMark size={22} />}
            </View>
            <Text
              style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: INK }}
            >
              {labelFor(second)}
            </Text>
            <Ionicons name={directionalIcon('chevron-forward')} size={20} color={INK} />
          </Pressable>

          <Row style={{ alignItems: 'center', gap: 12, marginVertical: 2 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
            <Text style={{ fontSize: 14, color: MUTED }}>{t.signIn.orContinueWithCap}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
          </Row>

          <Row style={{ gap: 12 }}>
            {/* Only where the build can actually do it: Firebase sends the code,
                and a binary made before it existed would draw a dead door. */}
            {phoneSignInAvailable() ? (
              <WayTile
                testID="auth-phone"
                icon="call-outline"
                label={t.signIn.providerPhone}
                accessibilityLabel={t.signIn.continuePhone}
                disabled={busy}
                onPress={() => router.push('/phone')}
              />
            ) : null}
            <WayTile
              testID="auth-email"
              icon="mail-outline"
              label={t.signIn.providerEmail}
              accessibilityLabel={t.signIn.continueEmail}
              disabled={busy}
              onPress={() => router.push('/sign-up')}
            />
          </Row>

          <LegalLine textStyle={{ color: MUTED, lineHeight: 20, marginTop: 4 }} />

          <View style={{ height: 1, backgroundColor: LINE, marginHorizontal: 40, marginTop: 4 }} />

          <Row style={{ justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16, color: MUTED }}>{t.signIn.haveAccountPrompt}</Text>
            <Pressable
              testID="welcome-sign-in"
              accessibilityRole="button"
              accessibilityLabel={t.signIn.signInAction}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => router.push('/sign-in')}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 17, fontWeight: '800', color: ACCENT }}>
                {t.signIn.signInAction}
              </Text>
              <Ionicons name={directionalIcon('arrow-forward')} size={18} color={ACCENT} />
            </Pressable>
          </Row>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

/** Phone or Email: a white tile with its glyph and one word. */
function WayTile({
  testID,
  icon,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 54,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: LINE,
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={24} color={ACCENT} />
      <Text style={{ fontSize: 17, fontWeight: '700', color: INK }}>{label}</Text>
    </Pressable>
  );
}

/** Both provider pills share their shape: 56 tall, the mark on a disc at the
 *  leading edge, the label centred, a chevron trailing. */
const providerRow = {
  height: 56,
  borderRadius: 28,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  paddingStart: 6,
  paddingEnd: 20,
  gap: 8,
};
const markDisc = {
  width: 44,
  height: 44,
  borderRadius: 22,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: '#FFFFFF',
};

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
