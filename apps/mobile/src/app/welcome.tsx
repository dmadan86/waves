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
import { Image, Platform, Pressable, useWindowDimensions, View } from 'react-native';
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
import { deviceDefaultCurrency, LANGUAGE_NAMES, useStrings } from '@/i18n';
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

const SCENE = require('../../assets/images/welcome-scene.webp') as number;
const FRIENDS = require('../../assets/images/welcome-friends.webp') as number;
const WORDMARK = require('../../assets/images/wordmark-script.webp') as number;

export default function WelcomeScreen() {
  const theme = useTheme();
  const { t, language, locale } = useStrings();
  const { withGoogle, withApple } = useAuth();
  const { height: screenHeight, width: windowWidth } = useWindowDimensions();
  // The chips' amounts in the phone's own currency, whole units.
  const chipAmount = (value: number): string => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: deviceDefaultCurrency(),
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(value);
    }
  };
  // The room between the tagline and the sheet, measured: the friends and the
  // cards over them are sized to it, so on a short phone they shrink rather
  // than climb over the words.
  const [stage, setStage] = useState(0);
  const friendsH = Math.max(90, Math.min(windowWidth * 1.08 * (614 / 1200), stage - 8));
  const friendsW = friendsH * (1200 / 614);
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
      {/* The picture: a terrace at sunset across the top of the screen, down
          past where the sheet begins so its rounded corners sit on it. */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: screenHeight }}>
        {/* Lifted a little, so the hills and the bay sit behind the friends
            rather than behind the sheet. */}
        <Image
          source={SCENE}
          resizeMode="cover"
          style={{
            position: 'absolute',
            top: -screenHeight * 0.1,
            left: 0,
            right: 0,
            height: screenHeight * 1.1,
          }}
        />
        {/* A light veil over the top of the sky only, where the words are; the
            sunset, the hills and the sea below it show as they are. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.75)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
          locations={[0, 0.18, 0.32]}
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
              <Text
                maxFontSizeMultiplier={1.15}
                style={{ fontSize: 15, fontWeight: '600', color: INK }}
              >
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
            <Text
              maxFontSizeMultiplier={1.15}
              style={{ fontSize: 16, fontWeight: '700', color: INK }}
            >
              {t.common.skip}
            </Text>
            <Ionicons name={directionalIcon('arrow-forward')} size={18} color={INK} />
          </Pressable>
        </Row>

        {/* The words, over the top of the picture, rising into place. */}
        <Animated.View
          style={[{ paddingHorizontal: theme.spacing.xl, paddingTop: 12, gap: 8 }, heroStyle]}
        >
          <Image
            source={WORDMARK}
            accessibilityRole="header"
            accessibilityLabel={t.common.appName}
            resizeMode="contain"
            style={{ width: 140, height: 140 * (256 / 720), marginBottom: 2 }}
          />
          <Text
            maxFontSizeMultiplier={1.15}
            style={{
              fontSize: 32,
              lineHeight: 40,
              fontWeight: '800',
              color: INK,
              letterSpacing: -0.8,
            }}
          >
            {t.signIn.splitAnything}
          </Text>
          <Text
            maxFontSizeMultiplier={1.15}
            style={{ fontSize: 16, lineHeight: 23, color: MUTED, maxWidth: 320 }}
          >
            {t.signIn.heroTagline}
          </Text>
        </Animated.View>

        {/* The friends at their table, standing on the sheet's edge, with a few
            of the things they split floating over them. Decorative. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onLayout={(event) => setStage(event.nativeEvent.layout.height)}
          style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}
        >
          <Image
            source={FRIENDS}
            resizeMode="contain"
            style={{ width: friendsW, height: friendsH, marginBottom: -22 }}
          />
          <SplitChip
            icon="home-outline"
            label={t.signIn.chipRent}
            amount={chipAmount(320)}
            faces={2}
            style={{ position: 'absolute', left: 14, bottom: friendsH * 0.74 }}
          />
          <SplitChip
            icon="airplane-outline"
            label={t.signIn.chipTrip}
            amount={chipAmount(620)}
            faces={3}
            style={{ position: 'absolute', right: 36, bottom: friendsH * 0.74 + 16 }}
          />
          <SplitChip
            icon="restaurant-outline"
            label={t.signIn.chipDinner}
            amount={chipAmount(48)}
            faces={3}
            style={{
              position: 'absolute',
              right: -14,
              bottom: friendsH * 0.52,
              transform: [{ rotate: '4deg' }],
            }}
          />
        </View>

        {/* The ways in, on a white sheet that rises over the picture's foot. */}
        <Animated.View
          style={[
            {
              backgroundColor: SHEET,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              paddingHorizontal: theme.spacing.xl,
              paddingTop: 16,
              paddingBottom: theme.spacing.sm,
              gap: 9,
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
                {first === 'apple' ? (
                  <AppleMark size={20} color="#000000" />
                ) : (
                  <GoogleMark size={20} />
                )}
              </View>
              <Text
                maxFontSizeMultiplier={1.15}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 15,
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
              {second === 'apple' ? (
                <AppleMark size={24} color="#000000" />
              ) : (
                <GoogleMark size={20} />
              )}
            </View>
            <Text
              maxFontSizeMultiplier={1.15}
              style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: INK }}
            >
              {labelFor(second)}
            </Text>
            <Ionicons name={directionalIcon('chevron-forward')} size={20} color={INK} />
          </Pressable>

          <Row style={{ alignItems: 'center', gap: 12, marginVertical: 2 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
            <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 14, color: MUTED }}>
              {t.signIn.orContinueWithCap}
            </Text>
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

          <LegalLine textStyle={{ color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 2 }} />

          <View style={{ height: 1, backgroundColor: LINE, marginHorizontal: 40, marginTop: 4 }} />

          <Row style={{ justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 16, color: MUTED }}>
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
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.15}
                style={{ fontSize: 17, fontWeight: '800', color: ACCENT }}
              >
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

/** One of the floating cards over the friends: what was split, how much, and
 *  the little row of faces it was split between. */
function SplitChip({
  icon,
  label,
  amount,
  faces,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  amount: string;
  faces: number;
  style: object;
}) {
  const tints = ['#F2C4A0', '#C7A77F', '#E3B28C'];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          paddingStart: 6,
          paddingEnd: 10,
          borderRadius: 16,
          backgroundColor: 'rgba(255,255,255,0.92)',
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#EFEBFD',
        }}
      >
        <Ionicons name={icon} size={18} color={ACCENT} />
      </View>
      <View>
        <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 11, color: INK }}>
          {label}
        </Text>
        <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 13, fontWeight: '700', color: INK }}>
          {amount}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', marginStart: 4 }}>
        {Array.from({ length: faces }, (_, index) => (
          <View
            key={index}
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              marginStart: index === 0 ? 0 : -6,
              borderWidth: 1.5,
              borderColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tints[index % tints.length],
            }}
          >
            <Ionicons name="person" size={11} color="#6B4A32" />
          </View>
        ))}
      </View>
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
        height: 44,
        borderRadius: 14,
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
      <Ionicons name={icon} size={20} color={ACCENT} />
      <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 15, fontWeight: '700', color: INK }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Both provider pills share their shape: 56 tall, the mark on a disc at the
 *  leading edge, the label centred, a chevron trailing. */
const providerRow = {
  height: 46,
  borderRadius: 23,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  paddingStart: 6,
  paddingEnd: 20,
  gap: 8,
};
const markDisc = {
  width: 36,
  height: 36,
  borderRadius: 18,
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
