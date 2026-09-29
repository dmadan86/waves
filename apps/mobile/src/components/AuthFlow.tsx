/**
 * Getting in — the shared machinery behind the login and the sign-up screens.
 *
 * There are two front doors, one file. `flow` decides which: `'login'` is the
 * screen a returning person lands on, and `'signup'` is the separate page behind
 * "Create account", where a new person picks how to start and where the guest
 * way in lives. Keeping both in one component is deliberate: the form underneath
 * is identical, and two copies of a login form is exactly how one drifts from
 * the other.
 *
 * The layout is one sheet with one hierarchy: a title and a muted line, the
 * email-and-password card, the passwordless links as text under it ("Email me
 * a code" on both doors, "Forgot password" on the login door — both mail a
 * one-time code to the address in the field, with a one-minute resend cool-down
 * so a frustrated tap cannot spray the mailbox), then the single primary button.
 * The other ways in — Google, Apple, phone — sit at the foot as three icon
 * tiles under a seam. Exactly one full-width button on the screen, on purpose:
 * the previous sheet stacked six of them at the same weight and read as bloat.
 *
 * Which Supabase call each button makes is decided in @waves/core, not here. A
 * guest who taps a provider or types a password must have that way *added* to the
 * account they already have — signing them in fresh would strand a week of
 * expenses on an account they can no longer reach (ADR-006). The passwordless
 * email-code path cannot express that "add in place", so it is hidden for a guest
 * (`isGuest`): they upgrade with a password or a provider, never a fresh code.
 *
 * ADR-006 is that nobody is made to register before they can split a bill. The
 * guest button sits on the sign-up page, one tap behind "Create account" — still
 * not behind a form, still reachable before any detail is asked, but off the
 * login screen a returning member sees. (ADR-006 addendum — see the PR.)
 */

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Callout, directionalIcon, Row, Screen, Text, useTheme } from '@waves/ui';

import { useBottomClearance } from '@/lib/clearance';
import { AppleMark, GoogleMark } from '@/components/SocialTile';
import { useStrings, type UiStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useIdentityTaken } from '@/lib/useIdentityTaken';
import { friendlyError } from '@/lib/errors';
import { router, useGoBack } from '@/lib/navigation';
import { CodeRoute, codeRouteFor, looksLikePhone } from '@/lib/authCodeRoute';
import { phoneSignInAvailable } from '@/lib/phoneAuth';

export type AuthFlowKind = 'login' | 'signup';

/** Which face the middle of the sheet is showing: the email-and-password form,
 *  or the one-time code the two passwordless links drop into. */
enum Stage {
  Form = 'form',
  Code = 'code',
}

const RESEND_SECONDS = 60;

/** The page's own light palette and type, the door's: a front-of-house screen,
    the same in every theme. */
const INK = '#16163A';
const MUTED = '#5C6078';
const FAINT = '#8F93A8';
const ACCENT = '#6A45E8';
const LINE = '#E6E4F0';
const PAGE = '#F6F3FC';
const DISPLAY = 'PlusJakartaSans-ExtraBold';
const BODY = 'PlusJakartaSans-Medium';

const SCENE = require('../../assets/images/welcome-scene.webp') as number;
const FRIENDS = require('../../assets/images/welcome-friends.webp') as number;
const WORDMARK = require('../../assets/images/wordmark-script.webp') as number;

export function AuthFlow({ flow }: { flow: AuthFlowKind }) {
  const theme = useTheme();
  const { t } = useStrings();
  const goBack = useGoBack('/welcome');
  const reduceMotion = useReducedMotion();
  const { withPassword, withGoogle, withApple, sendEmailOtp, verifyEmailOtp, isGuest } = useAuth();
  const resolveIdentityTaken = useIdentityTaken();

  const isSignup = flow === 'signup';
  const intent: 'sign_in' | 'sign_up' = isSignup ? 'sign_up' : 'sign_in';

  // Whether a code can be sent to a number at all, from this build and on this
  // door. The same two conditions the "Continue with phone" tile is drawn
  // under, and deliberately the same expression: a link that promised a text
  // where that tile is absent would lead exactly where the tile does not go.
  const phoneCodeOffered = !isSignup && phoneSignInAvailable();

  /**
   * Whether to ask what to call them.
   *
   * On the two doors that mint or claim an account, and nowhere else. A
   * `profiles` row is named once, by a trigger reading the provider's metadata
   * — and an email-and-password sign-up sends no name at all, so the trigger
   * falls through to its `Guest` placeholder and nothing in the product ever
   * revisits it. A customer signed up, confirmed their address, and read
   * "Guest" as their own name on their settings screen; so did everybody they
   * split a bill with. The accounts already carrying it are repaired by
   * migration; this is the door being shut.
   *
   * Not on the login door: that account already has whatever name it has, and
   * a field there would offer to overwrite it as a side effect of signing in.
   */
  const askName = isSignup || isGuest;

  const [stage, setStage] = useState<Stage>(Stage.Form);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordShown, setPasswordShown] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearance = useBottomClearance(theme.spacing.xxl);
  const { width: windowWidth, height: screenHeight } = useWindowDimensions();

  // Whether the keyboard is up, so the scatter band above the title can stand
  // down and give the form the room. `KeyboardAvoidingView` moves the content
  // but cannot know that one part of it is decoration worth dropping.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    // `Did` rather than `Will` on Android, where the `Will` events do not fire.
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Seconds left on the resend cool-down; 0 means "you may send again". A ref
  // holds the interval so a second send does not stack timers.
  const [resendLeft, setResendLeft] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const startResendTimer = (): void => {
    if (tickRef.current) clearInterval(tickRef.current);
    setResendLeft(RESEND_SECONDS);
    tickRef.current = setInterval(() => {
      setResendLeft((left) => {
        if (left <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          tickRef.current = null;
          return 0;
        }
        return left - 1;
      });
    }, 1000);
  };

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (thrown) {
      // A guest whose Google or Apple login already has an account is asked
      // whether to switch to it, rather than told the sign-in failed.
      const caught = await resolveIdentityTaken(thrown);
      if (caught === null) return undefined;
      setError(
        friendlyError(
          caught,
          t.signIn.couldNotSignIn,
          'auth.signIn',
          t.misc.connectionProblem,
          t.misc.tooManyTries,
        ),
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Both passwordless links send a code to whatever is in the field — and the
   * field takes either kind of thing, so this decides which "send a code" it
   * meant.
   *
   * An email goes out from here: Supabase mails it and the card turns to its
   * own code stage. A number cannot, because phone codes are Firebase's and
   * land on a screen of their own (`app/phone.tsx`, and see `lib/phoneAuth`
   * for why the two were never folded together) — so the number is carried
   * there rather than refused. It used to be refused, on a field whose own
   * placeholder invites a phone number, with the working door sitting below
   * the fold under the keyboard. That is the bug this fixes.
   *
   * A build with no Firebase in it has no phone door at all, and there the old
   * refusal is the honest answer again: better to say "an email, please" than
   * to push a screen whose every tap is dead.
   */
  const sendCode = (): void => {
    switch (codeRouteFor(identifier, phoneCodeOffered)) {
      case CodeRoute.Email:
        void run(async () => {
          await sendEmailOtp(identifier, isSignup);
          setCode('');
          setStage(Stage.Code);
          startResendTimer();
        });
        return;
      case CodeRoute.Phone:
        router.push({ pathname: '/phone', params: { number: identifier.trim() } });
        return;
      case CodeRoute.Nothing:
        setError(phoneCodeOffered ? t.signIn.enterEmailOrPhoneFirst : t.signIn.enterEmailFirst);
        return;
    }
  };

  const submitPassword = (): void => {
    void (async () => {
      const outcome = await run(() =>
        withPassword(identifier, password, intent, askName ? name : undefined),
      );
      // A confirmation mail went out — send them to check it rather than leave
      // them on a form that looks inert.
      if (outcome?.verifyEmail) {
        router.push({ pathname: '/verify-email', params: { email: outcome.verifyEmail } });
      }
    })();
  };

  // Each field its own rounded box with a leading glyph, as the design draws
  // them. Fixed height so a box does not breathe when the platform's text
  // input decides on its own padding.
  const fieldStyle = {
    height: 48,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  } as const;
  const inputStyle = {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: INK,
    paddingVertical: 0,
  } as const;

  const title = isSignup ? t.signIn.createAccount : t.signIn.welcomeBack;
  const submitLabel = isGuest
    ? t.signIn.addToAccount
    : isSignup
      ? t.signIn.createAccount
      : t.signIn.signInAction;
  const subline = isGuest
    ? t.signIn.guestAddWay
    : isSignup
      ? t.signIn.signupSubline
      : t.signIn.loginSubline;

  const heroFriendsH = windowWidth * 0.94 * (614 / 1200);

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      {/* The door's terrace, softened to a pastel behind the form: the same
          place as the door, a step further in. */}
      <Image
        source={SCENE}
        resizeMode="cover"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: Math.max(windowWidth, screenHeight * (849 / 1852)),
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(250,246,255,0.62)',
        }}
      />
      {/* Soft lavender swells along the foot, under the card. */}
      <Svg
        pointerEvents="none"
        width={windowWidth}
        height={150}
        viewBox="0 0 400 150"
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, bottom: 0 }}
      >
        <Path
          d="M0 70 C 90 30, 170 100, 260 70 S 360 30, 400 50 L400 150 L0 150 Z"
          fill="#E6DEFB"
          opacity={0.8}
        />
        <Path
          d="M0 105 C 110 70, 200 130, 300 100 S 380 80, 400 90 L400 150 L0 150 Z"
          fill="#D8CCF8"
          opacity={0.75}
        />
      </Svg>
      <Screen edges={['top', 'bottom']} style={{ backgroundColor: 'transparent' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          {/* Header: back on the leading side, language on the trailing side —
              reachable from the first frame for somebody who opened the app in a
              script they cannot read. Round white buttons over the picture. */}
          <Row style={{ paddingHorizontal: theme.spacing.lg, minHeight: 48 }}>
            <HeaderGlyph
              label={t.common.back}
              icon={directionalIcon('chevron-back')}
              onPress={goBack}
            />
            <View style={{ flex: 1, alignItems: 'center' }}>
              {keyboardOpen ? null : (
                <Image
                  source={WORDMARK}
                  accessibilityLabel={t.common.appName}
                  resizeMode="contain"
                  style={{ width: windowWidth * 0.34, height: windowWidth * 0.34 * (256 / 720) }}
                />
              )}
            </View>
            <HeaderGlyph
              label={t.language}
              icon="globe-outline"
              onPress={() => router.push('/language')}
            />
          </Row>

          {/* One screen, as drawn: it only scrolls while the keyboard is up
              and the card has to move to stay reachable. */}
          <ScrollView
            style={{ flex: 1 }}
            scrollEnabled={keyboardOpen}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: keyboardOpen ? clearance : 0 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* The picture above the card: the wordmark, the things people split
                strung on a line, and the friends. Stands down while the keyboard
                is up — somebody typing a password needs the room. */}
            {keyboardOpen ? (
              <View style={{ height: theme.spacing.md }} />
            ) : (
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ alignItems: 'center' }}
              >
                <View style={{ width: windowWidth, height: 70 }}>
                  <Svg width={windowWidth} height={80} style={{ position: 'absolute' }}>
                    <Path
                      d={`M0 40 C ${windowWidth * 0.18} 10, ${windowWidth * 0.32} 70, ${windowWidth * 0.5} 52 S ${windowWidth * 0.8} 10, ${windowWidth} 30`}
                      stroke="#D9D2FB"
                      strokeWidth={2}
                      fill="none"
                    />
                  </Svg>
                  <Bubble icon="receipt-outline" fg="#B7792E" bg="#FCE6C8" left={0.08} top={2} />
                  <Bubble icon="cafe-outline" fg="#6A45E8" bg="#E6E0FB" left={0.27} top={24} />
                  <Bubble icon="card-outline" fg="#D6457E" bg="#FBDDE8" left={0.6} top={16} />
                  <Bubble icon="people-outline" fg="#2F6FE4" bg="#D9E8FC" left={0.77} top={-6} />
                </View>
                <Image
                  source={FRIENDS}
                  resizeMode="contain"
                  style={{ width: windowWidth * 0.94, height: heroFriendsH, marginBottom: -22 }}
                />
              </View>
            )}

            {/* The card: the whole form, on white. */}
            <View
              style={{
                marginHorizontal: theme.spacing.lg,
                borderRadius: 28,
                backgroundColor: 'rgba(255,255,255,0.97)',
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 16,
                shadowColor: '#2A1E6B',
                shadowOpacity: 0.1,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 8 },
                elevation: 6,
              }}
            >
              <View style={{ gap: 2, marginBottom: 14 }}>
                <Text
                  maxFontSizeMultiplier={1.15}
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 30,
                    lineHeight: 36,
                    color: INK,
                    letterSpacing: -0.6,
                  }}
                >
                  {title}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.15}
                  style={{ fontFamily: BODY, fontSize: 14, color: MUTED }}
                >
                  {subline}
                </Text>
              </View>

              {stage === Stage.Form ? (
                <Animated.View
                  key="form"
                  entering={reduceMotion ? undefined : FadeIn.duration(160)}
                  style={{ gap: 10 }}
                >
                  {/* First, because it is the first thing anybody would say.
                      Optional — it is a name, not a credential, and refusing to
                      create an account over a blank one would be picking a fight
                      at the door. Left blank, the profile keeps its placeholder
                      and settings can rename it later. */}
                  {askName ? (
                    <View style={fieldStyle}>
                      <Ionicons name="person-outline" size={20} color={INK} />
                      <TextInput
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="words"
                        autoCorrect={false}
                        autoComplete="name"
                        textContentType="name"
                        accessibilityLabel={t.common.yourName}
                        placeholder={t.common.yourName}
                        placeholderTextColor={FAINT}
                        style={inputStyle}
                      />
                    </View>
                  ) : null}
                  <View style={fieldStyle}>
                    <Ionicons name="mail-outline" size={20} color={INK} />
                    <TextInput
                      value={identifier}
                      onChangeText={setIdentifier}
                      autoCapitalize="none"
                      autoCorrect={false}
                      // The field takes either kind of thing, and this keyboard
                      // has the letters, the digits and the "@" all on it.
                      keyboardType="email-address"
                      autoComplete="username"
                      accessibilityLabel={t.signIn.identifier}
                      placeholder={t.signIn.identifier}
                      placeholderTextColor={FAINT}
                      style={inputStyle}
                    />
                  </View>
                  <View style={fieldStyle}>
                    <Ionicons name="lock-closed-outline" size={20} color={INK} />
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!passwordShown}
                      autoCapitalize="none"
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                      accessibilityLabel={t.signIn.password}
                      placeholder={t.signIn.password}
                      placeholderTextColor={FAINT}
                      style={inputStyle}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        passwordShown ? t.signIn.hidePassword : t.signIn.showPassword
                      }
                      onPress={() => setPasswordShown((shown) => !shown)}
                      hitSlop={12}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <Ionicons
                        name={passwordShown ? 'eye-off-outline' : 'eye-outline'}
                        size={21}
                        color={INK}
                      />
                    </Pressable>
                  </View>

                  {/* Passwordless conveniences as text links on one row, not
                      buttons: "Forgot password" is login-only, "Email me a code"
                      is on both doors, neither is for a guest (a fresh code
                      cannot upgrade their account in place). */}
                  {!isGuest ? (
                    <Row
                      style={{
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 10,
                        marginTop: 2,
                      }}
                    >
                      {!isSignup ? (
                        <>
                          <TextLink testID="auth-forgot" onPress={sendCode} disabled={busy}>
                            {t.signIn.forgotPassword}
                          </TextLink>
                          {/* Decorative only: a screen reader should hear the
                              two links, not the dot between them. */}
                          <Text
                            style={{ color: ACCENT }}
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                          >
                            ·
                          </Text>
                        </>
                      ) : null}
                      <TextLink testID="auth-email-code" onPress={sendCode} disabled={busy}>
                        {/* The label follows the field, because the link does: a
                            number in the field sends a text. */}
                        {phoneCodeOffered && looksLikePhone(identifier)
                          ? t.signIn.textMeACode
                          : t.signIn.emailMeACode}
                      </TextLink>
                    </Row>
                  ) : null}

                  <PrimaryPill
                    testID="auth-submit"
                    label={submitLabel}
                    disabled={busy || !identifier.trim() || password.length < 8}
                    onPress={submitPassword}
                  />
                </Animated.View>
              ) : (
                <Animated.View
                  key="code"
                  entering={reduceMotion ? undefined : FadeIn.duration(160)}
                  style={{ gap: 12 }}
                >
                  {/* The code face: what was mailed, where, and the way back. */}
                  <Text style={{ fontSize: 14, color: MUTED }}>
                    {t.signIn.emailCodeSentTo.replace('{value}', identifier.trim())}
                  </Text>
                  <View style={[fieldStyle, { height: 64 }]}>
                    <TextInput
                      testID="auth-code"
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                      accessibilityLabel={t.contact.verificationCode}
                      placeholder="123456"
                      placeholderTextColor={FAINT}
                      style={{
                        flex: 1,
                        fontSize: 28,
                        fontWeight: '700',
                        letterSpacing: 8,
                        color: INK,
                        paddingVertical: 0,
                      }}
                    />
                  </View>
                  <PrimaryPill
                    testID="auth-verify"
                    label={t.signIn.verify}
                    disabled={busy || code.trim().length < 6}
                    onPress={() => void run(() => verifyEmailOtp(identifier.trim(), code.trim()))}
                  />
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <TextLink
                      tone="muted"
                      onPress={() => {
                        setStage(Stage.Form);
                        setCode('');
                        setError(null);
                      }}
                    >
                      {t.signIn.usePasswordInstead}
                    </TextLink>
                    <TextLink
                      testID="auth-resend"
                      onPress={sendCode}
                      disabled={busy || resendLeft > 0}
                      tone={resendLeft > 0 ? 'faint' : 'brand'}
                    >
                      {resendLeft > 0
                        ? t.signIn.resendIn.replace('{s}', String(resendLeft))
                        : t.signIn.resendCode}
                    </TextLink>
                  </Row>
                </Animated.View>
              )}

              {error ? (
                <View style={{ marginTop: 14 }}>
                  <Callout tone="negative">{error}</Callout>
                </View>
              ) : null}

              {/* The other ways in: a seam, then round buttons. */}
              <View style={{ gap: 12, marginTop: 14 }}>
                <Row style={{ alignItems: 'center', gap: 12 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
                  <Text style={{ fontSize: 14, color: MUTED }}>{t.signIn.orContinueWith}</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
                </Row>
                <SocialTiles
                  busy={busy}
                  onGoogle={() => void run(withGoogle)}
                  onApple={() => void run(withApple)}
                  // Absent from sign-up by the rule below, and absent from a
                  // build that cannot do it at all. Firebase is a native module:
                  // a JavaScript-only update onto a binary made before it
                  // existed leaves this tile drawn and every tap behind it dead.
                  onPhone={
                    isSignup || !phoneSignInAvailable() ? undefined : () => router.push('/phone')
                  }
                  t={t}
                />
                {/* ADR-006 addendum: the guest way in belongs to the sign-up
                    page — a text link, one tap, still before any detail. */}
                {isSignup && !isGuest ? (
                  <View style={{ alignItems: 'center' }}>
                    <TextLink
                      testID="auth-guest"
                      onPress={() => router.push('/guest-welcome')}
                      disabled={busy}
                    >
                      {t.signIn.continueGuest}
                    </TextLink>
                  </View>
                ) : null}
                {/* Only the guest upgrade, where the reassurance answers a real
                    question: "does the trip I have been adding to all week come
                    with me?" */}
                {isGuest ? (
                  <Text style={{ fontSize: 12, color: MUTED, textAlign: 'center' }}>
                    {t.signIn.guestFootnote}
                  </Text>
                ) : null}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </View>
  );
}

/** One of the floating things people split, on its own soft disc. */
function Bubble({
  icon,
  fg,
  bg,
  left,
  top,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  fg: string;
  bg: string;
  /** Share of the screen's width. */
  left: number;
  top: number;
}) {
  const { width } = useWindowDimensions();
  return (
    <View
      style={{
        position: 'absolute',
        left: width * left,
        top,
        width: 50,
        height: 50,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        shadowColor: '#2A1E6B',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      <Ionicons name={icon} size={24} color={fg} />
    </View>
  );
}

/** The one full-width button on the card: a violet gradient pill, an arrow
 *  after the word. */
function PrimaryPill({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 4,
        borderRadius: 23,
        opacity: disabled ? 0.55 : pressed ? 0.9 : 1,
        shadowColor: '#6A45E8',
        shadowOpacity: disabled ? 0 : 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: disabled ? 0 : 4,
      })}
    >
      <LinearGradient
        colors={['#7A5CF5', '#8E6CF7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          height: 46,
          borderRadius: 23,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <Text
          maxFontSizeMultiplier={1.15}
          style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}
        >
          {label}
        </Text>
        <Ionicons name={directionalIcon('arrow-forward')} size={20} color="#FFFFFF" />
      </LinearGradient>
    </Pressable>
  );
}

/** A 44pt header glyph — back, language. */
function HeaderGlyph({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.92)',
        opacity: pressed ? 0.6 : 1,
        shadowColor: '#2A1E6B',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      })}
    >
      <Ionicons name={icon} size={22} color={INK} />
    </Pressable>
  );
}

/** An inline text action — the secondary weight on this sheet, never a button. */
function TextLink({
  children,
  onPress,
  disabled = false,
  tone = 'brand',
  testID,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'brand' | 'muted' | 'faint';
  testID?: string;
}) {
  const color = tone === 'brand' ? ACCENT : tone === 'muted' ? MUTED : FAINT;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 16, fontWeight: '600', color }}>
        {children}
      </Text>
    </Pressable>
  );
}

/**
 * The tile row — Google, Apple, and phone on the login door only.
 *
 * Apple leads on iOS (its guidelines want it at least as prominent as the
 * others; App Store guideline 4.8 requires it alongside Google there); Google
 * leads elsewhere, where Apple is the browser fallback. Spoken labels are the
 * full "Continue with …" — Google's own wording for a button that both makes
 * an account and returns to one — and the visible caption is the one word.
 *
 * Phone is absent from sign-up on purpose. ADR-006 makes a number a way to keep
 * an account rather than a way to get one, so `auth.sms.enable_signup` is off
 * and `sendOtp` asks for no user to be created — a number nobody holds yet is
 * refused. Offering the tile on the sign-up door would advertise a door the
 * server does not open. Signing in with a number still reaches the same screen,
 * and so does a guest attaching one to the account they already have.
 */
function SocialTiles({
  busy,
  onGoogle,
  onApple,
  onPhone,
  t,
}: {
  busy: boolean;
  onGoogle: () => void;
  onApple: () => void;
  /** Omitted on the sign-up door, where a new number cannot make an account. */
  onPhone?: () => void;
  t: UiStrings;
}) {
  const google = (
    <RoundWay
      key="google"
      testID="auth-google"
      label={t.signIn.continueGoogle}
      caption={t.signIn.providerGoogle}
      disabled={busy}
      onPress={onGoogle}
      face="#FFFFFF"
    >
      <GoogleMark size={26} />
    </RoundWay>
  );
  const apple = (
    <RoundWay
      key="apple"
      testID="auth-apple"
      label={t.signIn.continueApple}
      caption={t.signIn.providerApple}
      disabled={busy}
      onPress={onApple}
      face="#000000"
    >
      <AppleMark size={28} />
    </RoundWay>
  );
  const phone = onPhone ? (
    <RoundWay
      key="phone"
      testID="auth-phone"
      label={t.signIn.continuePhone}
      caption={t.signIn.providerPhone}
      disabled={busy}
      onPress={onPhone}
      face="#F1EDFD"
    >
      <Ionicons name="call-outline" size={24} color={ACCENT} />
    </RoundWay>
  ) : null;
  const order = Platform.OS === 'ios' ? [apple, google, phone] : [google, apple, phone];
  return <Row style={{ justifyContent: 'center', gap: 30 }}>{order.filter(Boolean)}</Row>;
}

/** One round way in, with its one-word caption under it. */
function RoundWay({
  testID,
  label,
  caption,
  disabled,
  onPress,
  face,
  children,
}: {
  testID: string;
  label: string;
  caption: string;
  disabled: boolean;
  onPress: () => void;
  face: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        gap: 6,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: face,
          borderWidth: face === '#FFFFFF' ? 1 : 0,
          borderColor: LINE,
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        }}
      >
        {children}
      </View>
      <Text maxFontSizeMultiplier={1.15} style={{ fontSize: 14, color: MUTED }}>
        {caption}
      </Text>
    </Pressable>
  );
}
