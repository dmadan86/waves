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
import { ActivityIndicator, Image, Pressable, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { Callout, directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { LegalLine } from '@/components/LegalLine';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useGoBack } from '@/lib/navigation';

/** The screen's own dark-green field and the light on it — a front-of-house
    palette, held apart from the app theme on purpose. */
/** The art's own edges are all but black; the field meets them there. */
const FIELD = '#050F07';
const FIELD_TOP = '#0B2010';
const GLOW = '#3E6B2E';
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
        colors={[FIELD_TOP, FIELD, '#030904']}
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
              gap: 20,
              paddingHorizontal: theme.spacing.md,
            }}
          >
            {/* Full bleed: out through the column's padding to both edges. */}
            <View style={{ marginHorizontal: -(theme.spacing.xl + theme.spacing.md) }}>
              <SunriseArt />
            </View>
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

/** The sunrise over rolling hills, in rings of its own light — the screen's one
    picture, full width, its edges feathered into the field so it has no frame.
    Static: it is a picture, not a thing to watch. */
const SUNRISE = require('../../assets/images/guest-sunrise.webp') as number;

function SunriseArt() {
  const { width } = useWindowDimensions();
  const height = width / 1.5;
  const fade = (
    colors: [string, string],
    start: { x: number; y: number },
    end: { x: number; y: number },
    style: object,
  ) => (
    <LinearGradient
      colors={colors}
      start={start}
      end={end}
      style={[{ position: 'absolute' }, style]}
    />
  );
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height }}
    >
      <Image source={SUNRISE} style={{ width, height }} resizeMode="cover" />
      {fade(
        [`${FIELD}00`, FIELD],
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { left: 0, right: 0, bottom: 0, height: height * 0.3 },
      )}
      {fade(
        [FIELD, `${FIELD}00`],
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { left: 0, right: 0, top: 0, height: height * 0.15 },
      )}
      {fade(
        [FIELD, `${FIELD}00`],
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { left: 0, top: 0, bottom: 0, width: width * 0.12 },
      )}
      {fade(
        [`${FIELD}00`, FIELD],
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { right: 0, top: 0, bottom: 0, width: width * 0.12 },
      )}
    </View>
  );
}
