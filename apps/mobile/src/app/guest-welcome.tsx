/**
 * The guest doorway — one screen between "continue as guest" and the app.
 *
 * ADR-006 keeps registration optional, so a guest is a real, usable session
 * from the first tap. This screen is not a gate in front of that; it is the one
 * beat that says what "guest" means here — start now, nothing is lost, set up
 * whenever — the way the reference greets a new account before it opens.
 *
 * It is public (no session yet): the guest is minted by the Continue button,
 * not before it. So there is no race with the auth gate — tapping Continue calls
 * `continueAsGuest`, a session appears, and the gate takes it from here into the
 * app. Backing out returns to the sign-up door with nothing created.
 *
 * A deliberately dark field with its own palette, not the app's theme: this is a
 * front-of-house screen, like the splash and the gateway, and it reads as one.
 *
 * The copy is translated (see `t.entry`); the title's app name is tinted
 * wherever the translation places it.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { Callout, directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { LegalLine } from '@/components/LegalLine';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useGoBack } from '@/lib/navigation';

/** The screen's own dark-green field and the light on it — a front-of-house
    palette, held apart from the app theme on purpose. */
const FIELD = '#10200C';
const FIELD_TOP = '#1C3417';
const GLOW = '#3E6B2E';
const SUN_CORE = '#FFFBE8';
const SUN_EDGE = '#F1F3C8';
const HILL_LIGHT = '#6E9A4E';
const HILL_MID = '#3F6A2C';
const HILL_DARK = '#1E3A16';
const EDGE = '#C9E3A0';
/** The name in the title, and the button: the brand's violet. */
const VIOLET = '#7B5CF5';
const VIOLET_DEEP = '#6444EE';

/** The placeholder in `entry.guestIntroTitle` where the app name is tinted. */
const APP_TOKEN = '{app}';

export default function GuestWelcomeScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const goBack = useGoBack('/sign-up');
  const { continueAsGuest } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The title with the app name split out, so it can be tinted wherever the
  // translation places it. `split` with a captured group keeps the token.
  const titleParts = t.entry.guestIntroTitle.split(/(\{app\})/);

  const onContinue = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // The guest is made here. The session appearing sends the auth gate to
      // the dashboard, so there is nothing to navigate by hand.
      await continueAsGuest();
    } catch (caught) {
      setError(friendlyError(caught, t.signIn.couldNotSignIn, 'auth.guest'));
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: FIELD }}>
      <LinearGradient
        colors={[FIELD_TOP, FIELD, '#0B1708']}
        locations={[0, 0.55, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <FieldGlows />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            hitSlop={12}
            onPress={goBack}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={{ flex: 1, paddingHorizontal: theme.spacing.xl }}>
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              gap: 28,
              paddingHorizontal: theme.spacing.md,
            }}
          >
            <SunriseArt />
            <View style={{ gap: theme.spacing.md }}>
              {/* The app name is highlighted in brand wherever it falls in the
                  translated title — split on the {app} placeholder so the accent
                  survives word-order differences across languages. */}
              <Text align="center" style={{ fontSize: 32, lineHeight: 40, fontWeight: '800' }}>
                {titleParts.map((part, index) =>
                  part === APP_TOKEN ? (
                    <Text
                      key={index}
                      style={{
                        color: VIOLET,
                        fontSize: 32,
                        lineHeight: 40,
                        fontWeight: '800',
                      }}
                    >
                      {t.common.appName}
                    </Text>
                  ) : (
                    <Text
                      key={index}
                      style={{ color: '#FFFFFF', fontSize: 32, lineHeight: 40, fontWeight: '800' }}
                    >
                      {part}
                    </Text>
                  ),
                )}
              </Text>
              <Text align="center" style={{ color: '#FFFFFFD9', fontSize: 16, lineHeight: 25 }}>
                {t.entry.guestIntroBody}
              </Text>
            </View>
          </View>

          {error ? <Callout tone="negative">{error}</Callout> : null}

          <View style={{ paddingBottom: theme.spacing.xl, gap: theme.spacing.md }}>
            <LegalLine textStyle={{ color: '#FFFFFF80', fontSize: 12, lineHeight: 18 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.entry.continueLabel}
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={() => void onContinue()}
              style={({ pressed }) => ({
                borderRadius: 30,
                opacity: pressed ? 0.88 : 1,
                shadowColor: VIOLET,
                shadowOpacity: 0.45,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
              })}
            >
              <LinearGradient
                colors={['#8B6CFF', VIOLET_DEEP]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  height: 58,
                  borderRadius: 30,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>
                    {t.entry.continueLabel}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

/** The field's own light: a soft glow high on the right, and the curve of a
    hill low on the left. Behind everything, and never read. */
function FieldGlows() {
  return (
    <Svg
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      width="100%"
      height="100%"
      viewBox="0 0 400 860"
      preserveAspectRatio="xMidYMid slice"
    >
      <Defs>
        <RadialGradient id="corner" cx="100%" cy="0%" r="60%">
          <Stop offset="0" stopColor={GLOW} stopOpacity="0.55" />
          <Stop offset="1" stopColor={GLOW} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Path d="M0 0 H400 V520 H0 Z" fill="url(#corner)" />
      <Path d="M-40 560 C 60 600, 120 700, 140 860 L -40 860 Z" fill={GLOW} opacity={0.22} />
      <Path d="M-40 620 C 40 660, 90 740, 100 860" stroke={EDGE} strokeOpacity={0.12} fill="none" />
    </Svg>
  );
}

/** A sun rising over layered hills, in rings of its own light — the screen's
    one picture. Static: it is a picture, not a thing to watch. */
function SunriseArt() {
  const w = 340;
  const h = 230;
  const cx = w / 2;
  const horizon = 150;

  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#E9F5B8" stopOpacity="0.55" />
          <Stop offset="0.45" stopColor="#8DB860" stopOpacity="0.28" />
          <Stop offset="1" stopColor="#3E6B2E" stopOpacity="0" />
        </RadialGradient>
        <SvgGradient id="sun" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={SUN_CORE} />
          <Stop offset="1" stopColor={SUN_EDGE} />
        </SvgGradient>
        <SvgGradient id="hillBack" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={HILL_LIGHT} />
          <Stop offset="1" stopColor={HILL_DARK} />
        </SvgGradient>
        <SvgGradient id="hillFront" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={HILL_MID} />
          <Stop offset="1" stopColor={FIELD} />
        </SvgGradient>
      </Defs>

      {/* The glow, then the rings of light around the sun. */}
      <Circle cx={cx} cy={horizon - 10} r={130} fill="url(#halo)" />
      <Circle cx={cx} cy={horizon - 10} r={112} stroke={EDGE} strokeOpacity={0.14} fill="none" />
      <Circle cx={cx} cy={horizon - 10} r={86} stroke={EDGE} strokeOpacity={0.18} fill="none" />
      <Circle cx={cx} cy={horizon - 10} r={64} stroke={EDGE} strokeOpacity={0.22} fill="none" />
      <Circle cx={cx} cy={horizon - 6} r={44} fill="url(#sun)" />

      {/* The far hills, lit along their crests, then the near ones over the
          sun's foot. */}
      <Path
        d={`M4 ${horizon + 34} C 60 ${horizon - 2}, 110 ${horizon - 6}, 160 ${horizon + 14}
            S 250 ${horizon + 18}, 300 ${horizon + 2} S 336 ${horizon + 12}, 340 ${horizon + 16}
            L340 ${h} L4 ${h} Z`}
        fill="url(#hillBack)"
      />
      <Path
        d={`M4 ${horizon + 34} C 60 ${horizon - 2}, 110 ${horizon - 6}, 160 ${horizon + 14}
            S 250 ${horizon + 18}, 300 ${horizon + 2} S 336 ${horizon + 12}, 340 ${horizon + 16}`}
        stroke={EDGE}
        strokeOpacity={0.55}
        strokeWidth={1.4}
        fill="none"
      />
      <Path
        d={`M0 ${horizon + 50} C 70 ${horizon + 22}, 150 ${horizon + 30}, 200 ${horizon + 46}
            S 300 ${horizon + 30}, 340 ${horizon + 40} L340 ${h} L0 ${h} Z`}
        fill="url(#hillFront)"
      />
      <Path
        d={`M0 ${horizon + 50} C 70 ${horizon + 22}, 150 ${horizon + 30}, 200 ${horizon + 46}
            S 300 ${horizon + 30}, 340 ${horizon + 40}`}
        stroke={EDGE}
        strokeOpacity={0.35}
        strokeWidth={1.2}
        fill="none"
      />
      <Path
        d={`M20 ${h - 6} C 120 ${horizon + 50}, 220 ${horizon + 60}, 330 ${h - 20}`}
        stroke={EDGE}
        strokeOpacity={0.12}
        strokeWidth={1}
        fill="none"
      />
    </Svg>
  );
}
