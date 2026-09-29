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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Callout, directionalIcon, Row, Screen, Text } from '@waves/ui';

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
const FIELD_LINE = '#ECE9F5';
const GLYPH = '#4A4E68';
const PLACEHOLDER = '#8E92A6';
/** The Sign in pill before it can be pressed: a quiet lavender, on purpose. */
const PILL_REST = '#CFC4F6';
const DISPLAY = 'PlusJakartaSans-ExtraBold';
const BODY = 'PlusJakartaSans-Medium';

const SCENE = require('../../assets/images/welcome-scene.webp') as number;
const FRIENDS = require('../../assets/images/welcome-friends.webp') as number;
const WORDMARK = require('../../assets/images/wordmark-script.webp') as number;

export function AuthFlow({ flow }: { flow: AuthFlowKind }) {
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

  const { width: windowWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

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
    height: 58,
    borderWidth: 1,
    borderColor: FIELD_LINE,
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
    // The glyph, the words and the eye share one centre line.
    textAlignVertical: 'center',
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

  // The composition, measured rather than assumed, so it holds on any Android
  // height: the card starts at 44% of the page, unless its own content needs
  // more room, and the hero — bubbles and friends — takes what is above it.
  const [pageH, setPageH] = useState(0);
  const [headerH, setHeaderH] = useState(56);
  const [cardH, setCardH] = useState(0);
  const OVERLAP = 26;
  const cardTop = keyboardOpen
    ? headerH + 8
    : Math.max(headerH + 120, Math.min(pageH * 0.44, pageH - cardH));
  const heroSpace = cardTop - headerH;
  // The friends' table is hidden under the card: the picture's lower fifth
  // tucks behind it, which leaves the four faces well clear of the card edge.
  const HIDDEN = 0.2;
  const friendsH = Math.max(
    80,
    Math.min(windowWidth * (614 / 1200), (heroSpace - 46) / (1 - HIDDEN)),
  );
  const friendsW = friendsH * (1200 / 614);

  const form =
    stage === Stage.Form ? (
      <Animated.View key="form" entering={reduceMotion ? undefined : FadeIn.duration(160)}>
        {/* First, because it is the first thing anybody would say. Optional —
            it is a name, not a credential, and refusing to create an account
            over a blank one would be picking a fight at the door. Left blank,
            the profile keeps its placeholder and settings can rename it. */}
        {askName ? (
          <View style={[fieldStyle, { marginBottom: 12 }]}>
            <Ionicons name="person-outline" size={20} color={GLYPH} />
            <TextInput
              maxFontSizeMultiplier={1}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="name"
              accessibilityLabel={t.common.yourName}
              placeholder={t.common.yourName}
              placeholderTextColor={PLACEHOLDER}
              style={inputStyle}
            />
          </View>
        ) : null}
        <View style={fieldStyle}>
          <Ionicons name="mail-outline" size={20} color={GLYPH} />
          <TextInput
            maxFontSizeMultiplier={1}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            // The field takes either kind of thing, and this keyboard has the
            // letters, the digits and the "@" all on it.
            keyboardType="email-address"
            autoComplete="username"
            accessibilityLabel={t.signIn.identifier}
            placeholder={t.signIn.identifier}
            placeholderTextColor={PLACEHOLDER}
            style={inputStyle}
          />
        </View>
        <View style={[fieldStyle, { marginTop: 12 }]}>
          <Ionicons name="lock-closed-outline" size={20} color={GLYPH} />
          <TextInput
            maxFontSizeMultiplier={1}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!passwordShown}
            autoCapitalize="none"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            accessibilityLabel={t.signIn.password}
            placeholder={t.signIn.password}
            placeholderTextColor={PLACEHOLDER}
            style={inputStyle}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={passwordShown ? t.signIn.hidePassword : t.signIn.showPassword}
            onPress={() => setPasswordShown((shown) => !shown)}
            hitSlop={12}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons
              name={passwordShown ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={GLYPH}
            />
          </Pressable>
        </View>

        {/* Passwordless conveniences as text links on one row, not buttons:
            "Forgot password" is login-only, "Email me a code" is on both doors,
            neither is for a guest (a fresh code cannot upgrade their account in
            place). */}
        {!isGuest ? (
          <Row style={{ justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
            {!isSignup ? (
              <>
                <TextLink testID="auth-forgot" onPress={sendCode} disabled={busy}>
                  {t.signIn.forgotPassword}
                </TextLink>
                {/* Decorative only: a screen reader should hear the two links,
                    not the dot between them. */}
                <Text
                  style={{ color: PLACEHOLDER }}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  ·
                </Text>
              </>
            ) : null}
            <TextLink testID="auth-email-code" onPress={sendCode} disabled={busy}>
              {/* The label follows the field, because the link does: a number
                  in the field sends a text. */}
              {phoneCodeOffered && looksLikePhone(identifier)
                ? t.signIn.textMeACode
                : t.signIn.emailMeACode}
            </TextLink>
          </Row>
        ) : null}

        <View style={{ marginTop: 22 }}>
          <PrimaryPill
            testID="auth-submit"
            label={submitLabel}
            disabled={busy || !identifier.trim() || password.length < 8}
            onPress={submitPassword}
          />
        </View>
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
        <View style={fieldStyle}>
          <TextInput
            maxFontSizeMultiplier={1}
            testID="auth-code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            accessibilityLabel={t.contact.verificationCode}
            placeholder="123456"
            placeholderTextColor={PLACEHOLDER}
            style={{
              flex: 1,
              fontSize: 26,
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
    );

  return (
    <View style={{ flex: 1, backgroundColor: PAGE }}>
      {/* The door's terrace, quietened: a lavender-white wash that is almost
          solid across the top — where the logo, the controls and the bubbles
          are — and thins toward the card, so the place is felt rather than
          competing with the page. */}
      <Image
        source={SCENE}
        resizeMode="cover"
        blurRadius={2}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: Math.max(windowWidth, screenHeight * (849 / 1852)),
        }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(248,245,255,0.94)',
          'rgba(246,242,255,0.82)',
          'rgba(244,239,253,0.58)',
          'rgba(244,239,253,0.5)',
        ]}
        locations={[0, 0.28, 0.45, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <Screen edges={['top']} style={{ backgroundColor: 'transparent' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1 }} onLayout={(event) => setPageH(event.nativeEvent.layout.height)}>
            {/* Header: back on the leading side, language on the trailing side —
                reachable from the first frame for somebody who opened the app
                in a script they cannot read. One size, one treatment, one
                baseline; the logo centred between them. */}
            <View
              onLayout={(event) => setHeaderH(event.nativeEvent.layout.height)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingTop: 10,
                paddingBottom: 6,
              }}
            >
              <HeaderGlyph
                label={t.common.back}
                icon={directionalIcon('chevron-back')}
                onPress={goBack}
              />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Image
                  source={WORDMARK}
                  accessibilityLabel={t.common.appName}
                  resizeMode="contain"
                  style={{ width: windowWidth * 0.26, height: windowWidth * 0.26 * (256 / 720) }}
                />
              </View>
              <HeaderGlyph
                label={t.language}
                icon="globe-outline"
                onPress={() => router.push('/language')}
              />
            </View>

            {/* The hero: bubbles strung above the friends, the friends standing
                behind the card with their table tucked out of sight. Stands down
                while the keyboard is up. */}
            {keyboardOpen || pageH === 0 ? null : (
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{
                  position: 'absolute',
                  top: headerH,
                  left: 0,
                  right: 0,
                  height: heroSpace + OVERLAP + friendsH * HIDDEN,
                }}
              >
                <Svg width={windowWidth} height={60} style={{ position: 'absolute', top: 4 }}>
                  <Path
                    d={`M0 34 C ${windowWidth * 0.2} 8, ${windowWidth * 0.36} 58, ${windowWidth * 0.52} 40 S ${windowWidth * 0.8} 8, ${windowWidth} 24`}
                    stroke="#E4DEFA"
                    strokeWidth={1.5}
                    fill="none"
                  />
                </Svg>
                <Bubble icon="receipt-outline" fg="#B98A4A" bg="#FBEBD6" left={0.08} top={12} />
                <Bubble icon="cafe-outline" fg="#7A5CF0" bg="#ECE7FD" left={0.27} top={30} />
                <Bubble icon="card-outline" fg="#D15C8B" bg="#FBE4EC" left={0.62} top={28} />
                <Bubble icon="people-outline" fg="#4C7FE0" bg="#E2ECFC" left={0.8} top={6} />
                <Image
                  source={FRIENDS}
                  resizeMode="contain"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    alignSelf: 'center',
                    width: friendsW,
                    height: friendsH,
                  }}
                />
              </View>
            )}

            {/* The card: a floating bottom sheet over the friends' feet. */}
            <View
              style={{
                position: 'absolute',
                top: cardTop,
                left: 0,
                right: 0,
                bottom: 0,
                borderTopLeftRadius: 30,
                borderTopRightRadius: 30,
                backgroundColor: '#FFFFFF',
                shadowColor: '#2A1E6B',
                shadowOpacity: 0.06,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: -4 },
                elevation: 3,
              }}
            >
              <ScrollView
                scrollEnabled={keyboardOpen}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                  paddingHorizontal: 24,
                  paddingTop: 26,
                  paddingBottom: insets.bottom + 16,
                }}
              >
                <View
                  onLayout={(event) =>
                    setCardH(event.nativeEvent.layout.height + 42 + insets.bottom)
                  }
                >
                  <Text
                    maxFontSizeMultiplier={1}
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 29,
                      lineHeight: 35,
                      color: INK,
                      letterSpacing: -0.6,
                    }}
                  >
                    {title}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1}
                    style={{
                      fontFamily: BODY,
                      fontSize: 16,
                      lineHeight: 22,
                      color: MUTED,
                      marginTop: 4,
                    }}
                  >
                    {subline}
                  </Text>

                  <View style={{ marginTop: 22 }}>{form}</View>

                  {error ? (
                    <View style={{ marginTop: 14 }}>
                      <Callout tone="negative">{error}</Callout>
                    </View>
                  ) : null}

                  {/* The other ways in: a seam, then three equal round buttons. */}
                  <View style={{ marginTop: 22, gap: 16 }}>
                    <Row style={{ alignItems: 'center', gap: 12 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
                      <Text maxFontSizeMultiplier={1} style={{ fontSize: 14, color: MUTED }}>
                        {t.signIn.orContinueWith}
                      </Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: LINE }} />
                    </Row>
                    <SocialTiles
                      busy={busy}
                      onGoogle={() => void run(withGoogle)}
                      onApple={() => void run(withApple)}
                      // Absent from sign-up by the rule below, and absent from a
                      // build that cannot do it at all: Firebase is a native
                      // module, and a tile over nothing is worse than no tile.
                      onPhone={
                        isSignup || !phoneSignInAvailable()
                          ? undefined
                          : () => router.push('/phone')
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
                    {/* Only the guest upgrade, where the reassurance answers a
                        real question: "does my week of expenses come with me?" */}
                    {isGuest ? (
                      <Text style={{ fontSize: 12, color: MUTED, textAlign: 'center' }}>
                        {t.signIn.guestFootnote}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
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
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: 0.92,
      }}
    >
      <Ionicons name={icon} size={19} color={fg} />
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
  // At rest it is a quiet lavender with soft-white words — plainly waiting, not
  // broken. With both fields filled it takes the full Waves gradient.
  const face = (
    <>
      <Text
        maxFontSizeMultiplier={1}
        style={{
          fontSize: 17,
          fontWeight: '700',
          color: disabled ? 'rgba(255,255,255,0.92)' : '#FFFFFF',
        }}
      >
        {label}
      </Text>
      <Ionicons
        name={directionalIcon('arrow-forward')}
        size={20}
        color={disabled ? 'rgba(255,255,255,0.92)' : '#FFFFFF'}
      />
    </>
  );
  const shape = {
    height: 54,
    borderRadius: 27,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 27,
        opacity: pressed ? 0.9 : 1,
        shadowColor: '#6A45E8',
        shadowOpacity: disabled ? 0 : 0.22,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: disabled ? 0 : 3,
      })}
    >
      {disabled ? (
        <View style={[shape, { backgroundColor: PILL_REST }]}>{face}</View>
      ) : (
        <LinearGradient
          colors={['#6A45E8', '#8B6CF6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={shape}
        >
          {face}
        </LinearGradient>
      )}
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
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.88)',
        borderWidth: 1,
        borderColor: 'rgba(230,226,244,0.9)',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={INK} />
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
      <Text maxFontSizeMultiplier={1} style={{ fontSize: 16, fontWeight: '600', color }}>
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
      <GoogleMark size={22} />
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
      face="#FFFFFF"
    >
      <AppleMark size={22} color="#111111" />
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
      face="#FFFFFF"
    >
      <Ionicons name="call-outline" size={22} color={ACCENT} />
    </RoundWay>
  ) : null;
  const order = Platform.OS === 'ios' ? [apple, google, phone] : [google, apple, phone];
  return <Row style={{ justifyContent: 'space-evenly' }}>{order.filter(Boolean)}</Row>;
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
          width: 52,
          height: 52,
          borderRadius: 26,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: face,
          borderWidth: 1,
          borderColor: FIELD_LINE,
        }}
      >
        {children}
      </View>
      <Text maxFontSizeMultiplier={1} style={{ fontSize: 14, color: MUTED }}>
        {caption}
      </Text>
    </Pressable>
  );
}
