/**
 * Continue with phone — a screen of its own, not a face of the auth card.
 *
 * "Continue with phone" on either door used to swap the card underneath for a
 * number field. It is a page now, the way the reference onboardings do it: one
 * question per screen, a heading that says what this step is, the field, and the
 * action pinned to the foot. Enter the number, then the same screen turns to the
 * code it sent — a back chevron steps between the two, then out to the door.
 *
 * Public (see `_layout`): reachable signed-out, from both `sign-in` and
 * `sign-up`. It does not care which — `sendOtp`/`verifyOtp` are the same call
 * either way, and a session appearing bounces the whole tree into the app, so
 * there is nothing here to branch on the errand. A guest attaching a number
 * lands here too; the OTP path adds the number to the account they already have.
 *
 * The copy is translated (see `t.entry`); only the `__DEV__` OTP hint stays
 * hardcoded, since it never reaches a release build.
 */

import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Callout, directionalIcon, Row, Screen, Text, useTheme } from '@waves/ui';

import { dialingCodeForCountry, splitDialCode } from '@waves/core';

import { CountryCodePicker } from '@/components/CountryCodePicker';
import { OtpInput, OTP_LEN } from '@/components/OtpInput';
import { deviceCountry, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { COMPACT_TYPE_CAP } from '@/lib/typeCap';

/** Matches the email code screen, so the two waits feel like one product. */
const RESEND_SECONDS = 60;
/** Four codes a number a day is the server's rule; three from one sitting
    leaves the person a fourth after they have gone away and come back. */
const MAX_RESENDS = 3;

/** The auth pages' own light palette and type: front-of-house, every theme. */
const PAGE = '#F6F4FD';
const INK = '#16163A';
const MUTED = '#5C6078';
const ACCENT = '#6A45E8';
const FIELD_LINE = '#ECE9F5';
const DISPLAY = 'PlusJakartaSans-ExtraBold';
const BODY = 'PlusJakartaSans-Medium';
const CARD = {
  backgroundColor: '#FFFFFF',
  borderRadius: 18,
  padding: 14,
  shadowColor: '#2A1E6B',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
} as const;
const WORDMARK = require('../../assets/images/wordmark-script.webp') as number;
const ART = require('../../assets/images/verify-phone.webp') as number;

export default function PhoneScreen() {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { t } = useStrings();
  const { sendOtp, verifyOtp, continueAsGuest } = useAuth();

  // A number carried in from the sign-in card, where one field takes an email
  // or a number and the person typed a number. It arrives as one string and
  // this screen holds two halves, so it is taken apart: a `+`-prefixed number
  // in a country we stock sets the picker too, and anything else is kept as
  // digits under whatever country the guess below chose. Typing it twice is
  // the thing worth avoiding; a wrong flag is not an improvement on that.
  const params = useLocalSearchParams<{ number?: string }>();
  const carried = typeof params.number === 'string' ? params.number : '';
  const split = splitDialCode(carried);

  // Same guess as the auth card: the handset's own country, India only when the
  // region is unknown or unstocked. The picker beside the field makes any wrong
  // guess a one-tap fix.
  const [country, setCountry] = useState<string>(() => {
    if (split) return split.country;
    const guess = deviceCountry();
    return guess && dialingCodeForCountry(guess) ? guess : 'IN';
  });
  const dialCode = dialingCodeForCountry(country) ?? '+91';

  const [phone, setPhone] = useState(() => (split ? split.national : carried.replace(/\D/g, '')));
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The wire form: dial code and local digits, no spaces or punctuation.
  const fullPhone = `${dialCode}${phone.replace(/\D/g, '')}`;

  // DEV-ONLY: real SMS is not wired yet, so a dev build skips the send and
  // accepts one fixed code, standing in a guest session so the app is walkable.
  // `__DEV__` is false in every release build, so none of this ships — a client
  // that accepted a magic code in production would be an auth bypass.
  const DEV_OTP = '000000';
  // A dev build stubs the send by default, because there is usually no Twilio
  // account behind it and a walkable app matters more than a real message.
  // Setting `EXPO_PUBLIC_DEV_REAL_OTP=true` takes the stub away and exercises
  // the actual WhatsApp path — the same code a release build runs.
  //
  // The guard stays anchored on `__DEV__`, so the flag cannot resurrect the
  // magic code in a release build however the environment is set: there,
  // `devStub` is false whatever this evaluates to, and a client that accepted
  // a fixed code in production would be an auth bypass.
  const devStub = __DEV__ && process.env.EXPO_PUBLIC_DEV_REAL_OTP !== 'true';

  // The same cool-down the email code screen uses. It is not decoration here:
  // the server allows four codes to a number a day, so a resend that can be
  // hammered spends the person's own daily allowance before they notice.
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [resends, setResends] = useState(0);

  // One interval for the screen, settling at zero; a resend winds it back up.
  useEffect(() => {
    if (stage !== 'code') return;
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const canResend = seconds <= 0 && resends < MAX_RESENDS && !busy && !devStub;

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(friendlyError(caught, t.signIn.couldNotSignIn, 'auth.phone'));
    } finally {
      setBusy(false);
    }
  };

  // Back steps the code stage to the number first, then leaves the screen.
  const onBack = (): void => {
    if (stage === 'code') {
      setStage('phone');
      setCode('');
      setError(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/welcome');
  };

  const artW = windowWidth * 0.4;

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      {/* A soft lavender page, swells of the brand along its foot. */}
      <LinearGradient
        colors={['#F7F5FE', '#F2EFFD', '#EEEAFC']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Svg
        pointerEvents="none"
        width={windowWidth}
        height={260}
        viewBox="0 0 400 260"
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, bottom: 0 }}
      >
        <Path
          d="M0 70 C 110 20, 210 120, 300 80 S 380 20, 400 30 L400 260 L0 260 Z"
          fill="#E9E3FC"
          opacity={0.7}
        />
        <Path
          d="M0 150 C 120 110, 230 190, 330 140 S 390 110, 400 115 L400 260 L0 260 Z"
          fill="#DCD2FA"
          opacity={0.6}
        />
      </Svg>

      <Screen edges={['top', 'bottom']} style={{ backgroundColor: 'transparent' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: 22,
              paddingBottom: theme.spacing.lg,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Back — steps to the number from the code, then out to the door. */}
            <Row style={{ paddingTop: 10 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.common.back}
                hitSlop={12}
                onPress={onBack}
                style={({ pressed }) => ({
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.9)',
                  borderWidth: 1,
                  borderColor: 'rgba(230,226,244,0.9)',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name={directionalIcon('chevron-back')} size={20} color={INK} />
              </Pressable>
            </Row>

            {/* The heading beside the picture: the logo, what this step is, and
                the promise under it. The picture stands down once a field has
                the keyboard, and on the code step. */}
            <View style={{ marginTop: 18, minHeight: stage === 'phone' ? artW * 1.05 : undefined }}>
              {stage === 'phone' ? (
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    position: 'absolute',
                    right: -22,
                    top: 30,
                    width: artW,
                    height: artW * (500 / 410),
                  }}
                >
                  <Image
                    source={ART}
                    resizeMode="cover"
                    style={{ width: '100%', height: '100%' }}
                  />
                  {/* Its edges feathered into the page so it has no frame. */}
                  <LinearGradient
                    colors={[PAGE, `${PAGE}00`]}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 36 }}
                  />
                  <LinearGradient
                    colors={[`${PAGE}00`, PAGE]}
                    style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 36 }}
                  />
                  <LinearGradient
                    colors={[PAGE, `${PAGE}00`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 30 }}
                  />
                </View>
              ) : null}
              <Image
                source={WORDMARK}
                accessibilityLabel={t.common.appName}
                resizeMode="contain"
                style={{ width: windowWidth * 0.24, height: windowWidth * 0.24 * (256 / 720) }}
              />
              <Text
                maxFontSizeMultiplier={COMPACT_TYPE_CAP}
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 26,
                  lineHeight: 32,
                  color: INK,
                  letterSpacing: -0.8,
                  marginTop: 10,
                  maxWidth: stage === 'phone' ? windowWidth * 0.52 : undefined,
                }}
              >
                {stage === 'phone' ? t.entry.verifyPhoneTitle : t.signIn.enterCodeTitle}
              </Text>
              <Text
                maxFontSizeMultiplier={COMPACT_TYPE_CAP}
                style={{
                  fontFamily: BODY,
                  fontSize: 14,
                  lineHeight: 20,
                  color: MUTED,
                  marginTop: 8,
                  maxWidth: stage === 'phone' ? windowWidth * 0.5 : undefined,
                }}
              >
                {stage === 'phone'
                  ? t.entry.verifyPhoneBody
                  : t.signIn.codeSentTo.replace('{value}', `${dialCode} ${phone}`)}
              </Text>
              {stage === 'code' ? (
                <>
                  {/* Mistyping the number is the likeliest reason nothing came,
                      so the way back to it sits with the number itself. */}
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={onBack}
                    style={({ pressed }) => ({
                      alignSelf: 'flex-start',
                      marginTop: 8,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>
                      {t.signIn.differentNumber}
                    </Text>
                  </Pressable>
                  {devStub ? (
                    <Text style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                      Dev build — enter {DEV_OTP} to continue.
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>

            {stage === 'phone' ? (
              <>
                {/* The field on a white card — a label above it, the country a
                    tapped control, the local digits beside it. */}
                <View style={[CARD, { marginTop: 18 }]}>
                  <Text
                    maxFontSizeMultiplier={COMPACT_TYPE_CAP}
                    style={{ fontSize: 13, fontWeight: '600', color: '#4A4E68', marginBottom: 8 }}
                  >
                    {t.signIn.phoneNumber}
                  </Text>
                  <Row
                    style={{
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 46,
                      paddingHorizontal: 6,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: FIELD_LINE,
                    }}
                  >
                    <CountryCodePicker code={country} onChange={setCountry} />
                    <View style={{ width: 1, height: 26, backgroundColor: FIELD_LINE }} />
                    <TextInput
                      maxFontSizeMultiplier={COMPACT_TYPE_CAP}
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      autoFocus
                      accessibilityLabel={t.signIn.phoneNumber}
                      placeholder={t.entry.phonePlaceholder}
                      placeholderTextColor="#9A9EB2"
                      style={{
                        flex: 1,
                        fontSize: 15,
                        fontWeight: '600',
                        color: INK,
                        paddingVertical: 6,
                      }}
                    />
                  </Row>
                </View>

                {/* What the number is for, said once and plainly. */}
                <Row style={{ alignItems: 'center', gap: 12, marginTop: 14, paddingHorizontal: 4 }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#ECE7FD',
                    }}
                  >
                    <Ionicons name="lock-closed-outline" size={16} color={ACCENT} />
                  </View>
                  <Text
                    maxFontSizeMultiplier={COMPACT_TYPE_CAP}
                    style={{ flex: 1, fontSize: 13, lineHeight: 18, color: '#4A4E68' }}
                  >
                    {t.entry.phoneNote}
                  </Text>
                </Row>
                {error ? (
                  <View style={{ marginTop: 14 }}>
                    <Callout tone="negative">{error}</Callout>
                  </View>
                ) : null}

                {/* The action pinned to the foot: a spacer eats the middle so it
                    sits at the bottom on a tall screen and rides up with the
                    keyboard on a short one. */}
                <View style={{ flex: 1, minHeight: 24 }} />
                <Pill
                  label={t.signIn.sendCode}
                  disabled={busy || phone.replace(/\D/g, '').length < 6}
                  busy={busy}
                  onPress={() =>
                    void run(async () => {
                      // Dev build: no SMS to send — go straight to the code
                      // field, where 000000 stands in.
                      if (!devStub) await sendOtp(fullPhone);
                      setSeconds(RESEND_SECONDS);
                      setStage('code');
                    })
                  }
                />
              </>
            ) : (
              <>
                <View style={[CARD, { marginTop: 22 }]}>
                  <OtpInput
                    value={code}
                    onChangeText={setCode}
                    length={OTP_LEN}
                    accessibilityLabel={t.contact.verificationCode}
                    autoFocus
                  />
                </View>

                {/* Countdown, then a live link, then the note that the road runs
                    out — the same three states as the email code screen. The
                    fixed height keeps the boxes still as it changes. */}
                <View style={{ alignItems: 'center', minHeight: 24, marginTop: 16 }}>
                  {seconds > 0 ? (
                    <Text style={{ fontSize: 14, color: MUTED }}>
                      {t.signIn.resendIn.replace('{s}', String(seconds))}
                    </Text>
                  ) : resends < MAX_RESENDS ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={!canResend}
                      hitSlop={8}
                      onPress={() =>
                        void run(async () => {
                          await sendOtp(fullPhone);
                          setResends((n) => n + 1);
                          setSeconds(RESEND_SECONDS);
                        })
                      }
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        opacity: pressed || !canResend ? 0.6 : 1,
                      })}
                    >
                      <Ionicons name="refresh" size={18} color={ACCENT} />
                      <Text style={{ fontSize: 15, fontWeight: '700', color: ACCENT }}>
                        {t.entry.resendCode}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={{ fontSize: 14, color: MUTED }}>{t.entry.resendLimit}</Text>
                  )}
                </View>

                {error ? (
                  <View style={{ marginTop: 14 }}>
                    <Callout tone="negative">{error}</Callout>
                  </View>
                ) : null}

                <View style={{ flex: 1, minHeight: 24 }} />
                <Pill
                  label={t.signIn.verify}
                  disabled={busy || code.length !== OTP_LEN}
                  busy={busy}
                  onPress={() =>
                    void run(async () => {
                      // Dev build: the fixed code takes a guest session so the
                      // app is walkable. Never in release.
                      if (devStub && code.trim() === DEV_OTP) {
                        await continueAsGuest();
                        return;
                      }
                      await verifyOtp(fullPhone, code.trim());
                    })
                  }
                />
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </View>
  );
}

/** The one action: the Waves gradient pill, a quiet lavender until it can go. */
function Pill({
  label,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const inner = busy ? (
    <ActivityIndicator color="#FFFFFF" />
  ) : (
    <>
      <Text
        maxFontSizeMultiplier={COMPACT_TYPE_CAP}
        style={{
          fontSize: 15,
          fontWeight: '700',
          color: disabled ? 'rgba(255,255,255,0.92)' : '#FFFFFF',
        }}
      >
        {label}
      </Text>
      <Ionicons
        name={directionalIcon('arrow-forward')}
        size={18}
        color={disabled ? 'rgba(255,255,255,0.92)' : '#FFFFFF'}
      />
    </>
  );
  const shape = {
    height: 46,
    borderRadius: 23,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 23,
        opacity: pressed ? 0.9 : 1,
        shadowColor: '#6A45E8',
        shadowOpacity: disabled ? 0 : 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: disabled ? 0 : 4,
      })}
    >
      {disabled && !busy ? (
        <View style={[shape, { backgroundColor: '#CFC4F6' }]}>{inner}</View>
      ) : (
        <LinearGradient
          colors={['#6A45E8', '#8B6CF6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={shape}
        >
          {inner}
        </LinearGradient>
      )}
    </Pressable>
  );
}
