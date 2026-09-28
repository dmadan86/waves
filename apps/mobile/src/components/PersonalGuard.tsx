/**
 * The shield in front of the private personal ledger.
 *
 * Every screen in the section — the Me tab and each `personal/*` room — shows
 * this, and they all read one unlock (`lib/personalLock`), so proving who you
 * are once covers the whole section until you genuinely leave it or the app
 * goes away for longer than the "Ask again after" window. Moving between the
 * rooms costs nothing.
 *
 * While the check is in flight the shield stays up, so the figures are never on
 * show behind the OS prompt, and a refusal leaves the user here with the two
 * honest choices — try again, or go back — rather than being thrown backwards a
 * few seconds later with nothing said.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { directionalIcon, Screen, Text, useTheme } from '@waves/ui';

import { SignInWall } from '@/components/SignInWall';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { usePersonalGate, type PersonalGateValue } from '@/lib/lock';
import { useGoBack } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

/**
 * Wraps a personal screen so its body never mounts while the section is shut.
 *
 * Two shields, in this order. The account wall asks whether there is anywhere
 * for a private ledger to be *kept* — a guest session cannot be signed back
 * into, so there is not (`components/SignInWall`). Only past that does the lock
 * ask whether this is you. The order is also why the gate lives one component
 * down: `usePersonalGate` raises the OS prompt on mount, and a guest being
 * asked for a fingerprint on the way to being turned away would be the app
 * asking a question it had already decided to ignore.
 */
export function PersonalGuard({ children }: { children: ReactNode }) {
  const { isGuest } = useAuth();
  if (isGuest) return <SignInWall area="personal" />;
  return <PersonalUnlock>{children}</PersonalUnlock>;
}

function PersonalUnlock({ children }: { children: ReactNode }) {
  const { t } = useStrings();
  const gate = usePersonalGate(t.lock.personalPrompt);
  if (!gate.unlocked) return <PersonalLocked gate={gate} />;
  return <>{children}</>;
}

/**
 * The shield itself, also used directly by the Me tab (whose body is the
 * section's home and computes its month before it can early-return).
 */
export function PersonalLocked({ gate }: { gate: PersonalGateValue }) {
  const theme = useTheme();
  const { t } = useStrings();
  const dark = theme.scheme === 'dark';
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  // Home is the fallback: this screen can be the first thing a cold open from a
  // shortcut or a notification lands on, with no history to pop.
  const goBack = useGoBack('/');

  return (
    <Screen edges={[]}>
      {/* Two soft circles bled off opposite corners — the page's only
          decoration, so the lock stays the thing looked at. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View
          style={{
            position: 'absolute',
            top: -140,
            left: -120,
            width: 320,
            height: 320,
            borderRadius: 160,
            backgroundColor: dark ? 'rgba(255,255,255,0.03)' : '#EFEDFB',
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: -170,
            right: -110,
            width: 360,
            height: 360,
            borderRadius: 180,
            backgroundColor: dark ? 'rgba(255,255,255,0.03)' : '#EAE7FB',
          }}
        />
      </View>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.lg,
          paddingHorizontal: theme.spacing.xl,
        }}
      >
        <LockMedallion accent={accent} dark={dark} />
        <Text
          style={{
            marginTop: theme.spacing.lg,
            fontSize: 28,
            lineHeight: 34,
            fontWeight: '800',
            color: ink,
            textAlign: 'center',
          }}
        >
          {t.lock.personalLockedTitle}
        </Text>
        <Text style={{ fontSize: 17, lineHeight: 24, color: muted, textAlign: 'center' }}>
          {gate.failed ? t.lock.personalLockedRefused : t.lock.personalLockedBody}
        </Text>
        {/* Only one of the three: a spinner while the OS sheet is up, the way
            back in once it has been refused, and nothing at all in the moment
            before the prompt appears — a button that flashes past is a button
            people press by accident. */}
        {gate.checking ? (
          <ActivityIndicator color={accent} />
        ) : gate.failed ? (
          <View
            style={{ alignSelf: 'stretch', gap: theme.spacing.md, marginTop: theme.spacing.sm }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.extras.unlock}
              onPress={gate.retry}
              style={({ pressed }) => ({
                height: 56,
                borderRadius: 28,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.sm,
                backgroundColor: accent,
                shadowColor: accent,
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 4,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="lock-open" size={20} color="#FFFFFF" />
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
                {t.extras.unlock}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.common.back}
              onPress={goBack}
              style={({ pressed }) => ({
                height: 54,
                borderRadius: 27,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.spacing.sm,
                borderWidth: 1.5,
                borderColor: dark ? theme.color.border : '#D9D3F7',
                backgroundColor: dark ? 'transparent' : '#FAF9FF',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name={directionalIcon('arrow-back')} size={20} color={accent} />
              <Text style={{ fontSize: 17, fontWeight: '700', color: accent }}>
                {t.common.back}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

/** The lock, drawn: a pale disc with a soft shadow under it, the padlock in the
 *  brand's violet, and two small strokes beside the shackle — "this is shut",
 *  said without a word. Decoration, hidden from screen readers. */
function LockMedallion({ accent, dark }: { accent: string; dark: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: 'center' }}
    >
      <View
        style={{
          width: MEDALLION,
          height: MEDALLION,
          borderRadius: MEDALLION / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: dark ? 'rgba(255,255,255,0.06)' : '#EFEDFA',
        }}
      >
        <Ionicons name="lock-closed" size={MEDALLION * 0.52} color={dark ? accent : '#8C7CF0'} />
        <View
          style={{
            position: 'absolute',
            top: MEDALLION * 0.22,
            right: MEDALLION * 0.24,
            width: 4,
            height: 18,
            borderRadius: 2,
            backgroundColor: accent,
            transform: [{ rotate: '25deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: MEDALLION * 0.33,
            right: MEDALLION * 0.14,
            width: 18,
            height: 4,
            borderRadius: 2,
            backgroundColor: accent,
            transform: [{ rotate: '-22deg' }],
          }}
        />
      </View>
      {/* The soft shadow the disc casts on the page. */}
      <View
        style={{
          width: MEDALLION * 0.62,
          height: 8,
          marginTop: -4,
          borderRadius: 4,
          backgroundColor: dark ? 'rgba(0,0,0,0.25)' : 'rgba(104, 69, 232, 0.12)',
        }}
      />
    </View>
  );
}

/** The lock medallion's diameter. */
const MEDALLION = 176;
