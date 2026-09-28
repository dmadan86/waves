/**
 * Typing in a promotion code.
 *
 * The grant is not written from here. `subscriptions` is not writable by a
 * client and `waves_redeem_promo` is SECURITY DEFINER for exactly that reason —
 * a paywall a client can insert its own row into is a paywall with a door in
 * the back. This screen collects four to twenty-four characters and says what
 * came back.
 *
 * Every refusal gets its own sentence. Expired, used up and mistyped send
 * somebody to check three different things, and one "that did not work" makes
 * them check all three.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { redeemPromoCode, type PromoOutcome } from '@/data/api';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

/**
 * The same shape the `promo_codes_shape` constraint enforces.
 *
 * Not validation — the database decides what a code is. This only avoids a
 * round trip for something that cannot possibly match, so a half-typed code
 * does not come back as "no code like that" before it has been finished.
 */
const CODE_SHAPE = /^[A-Z0-9]{4,24}$/;

/** Each refusal, in its own words. */
function refusal(reason: Extract<PromoOutcome, { ok: false }>['reason'], t: UiStrings): string {
  switch (reason) {
    case 'UNKNOWN_CODE':
      return t.promo.unknownCode;
    case 'EXPIRED':
      return t.promo.expired;
    case 'EXHAUSTED':
      return t.promo.exhausted;
    case 'ALREADY_REDEEMED':
      return t.promo.alreadyRedeemed;
  }
}

export default function RedeemScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState<Extract<PromoOutcome, { ok: true }> | null>(null);

  const redeem = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await redeemPromoCode(code.trim());
      if (outcome.ok) setGranted(outcome);
      else setError(refusal(outcome.reason, t));
    } catch (caught) {
      // Never the raw message: a build that reaches a project the migration has
      // not, reports "Could not find the function public.waves_redeem_promo".
      setError(friendlyError(caught, t.promo.couldNotRedeem, 'promo.redeem'));
    } finally {
      setBusy(false);
    }
  };

  const ready = !busy && CODE_SHAPE.test(code.trim());

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: ink }}>{t.promo.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.sm,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <GiftArt />
        {granted ? (
          <View style={{ gap: 12, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={44} color={theme.color.positive} />
            <Text style={{ fontSize: 24, fontWeight: '800', color: ink, textAlign: 'center' }}>
              {t.promo.granted}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: muted, textAlign: 'center' }}>
              {fill(t.promo.grantedBody, {
                until: new Date(granted.until).toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }),
              })}
            </Text>
            <Button label={t.common.close} variant="secondary" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <View style={{ gap: 6, alignItems: 'center' }}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: ink, textAlign: 'center' }}>
                {t.promo.title}
              </Text>
              <Text style={{ fontSize: 14, lineHeight: 20, color: muted, textAlign: 'center' }}>
                {t.promo.intro}
              </Text>
            </View>

            <Row
              style={{
                alignItems: 'center',
                gap: 12,
                height: 56,
                paddingLeft: 16,
                paddingRight: 10,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: dark ? theme.color.border : '#D9D3F6',
                backgroundColor: theme.color.surface,
              }}
            >
              <Ionicons name="ticket-outline" size={22} color={accent} />
              <View
                style={{
                  width: 1,
                  height: 26,
                  backgroundColor: dark ? theme.color.border : '#E4E1F0',
                }}
              />
              <TextInput
                value={code}
                // Upper-cased as it is typed rather than on submit, so what is
                // on screen is what gets looked up. The function upper-cases
                // too; this stops the two disagreeing in front of somebody.
                onChangeText={(next) => setCode(next.toUpperCase())}
                placeholder={t.promo.placeholder}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.promo.title}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                autoFocus
                maxLength={24}
                onSubmitEditing={() => {
                  if (ready) void redeem();
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 18,
                  letterSpacing: 1,
                  color: ink,
                  paddingVertical: 0,
                }}
              />
              {code ? (
                <IconButton
                  label={t.promo.clear}
                  onPress={() => {
                    setCode('');
                    setError(null);
                  }}
                >
                  <Ionicons name="close-circle" size={24} color={theme.color.textFaint} />
                </IconButton>
              ) : null}
            </Row>

            {error ? <Callout tone="negative">{error}</Callout> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.promo.redeem}
              accessibilityState={{ disabled: !ready, busy }}
              disabled={!ready}
              onPress={() => void redeem()}
              style={({ pressed }) => ({
                borderRadius: 28,
                opacity: !ready && !busy ? 0.5 : pressed ? 0.88 : 1,
                shadowColor: '#5B3FD9',
                shadowOpacity: dark ? 0 : 0.25,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 4,
              })}
            >
              <LinearGradient
                colors={dark ? [theme.color.brand, theme.color.brand] : ['#5A3FD8', '#7A5CF5']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  height: 54,
                  borderRadius: 28,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
                    {t.promo.redeem}
                  </Text>
                )}
                <Ionicons
                  name={directionalIcon('arrow-forward')}
                  size={22}
                  color="#FFFFFF"
                  style={{ position: 'absolute', end: 20 }}
                />
              </LinearGradient>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** The top picture: an open gift box with a starred ticket rising out of it,
 *  a little confetti and two leaves. Drawn from views and glyphs, so it themes
 *  and costs no asset. */
function GiftArt() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 170, alignItems: 'center', justifyContent: 'flex-end' }}
    >
      <View
        style={{
          position: 'absolute',
          bottom: 4,
          width: 230,
          height: 36,
          borderRadius: 115,
          backgroundColor: dark ? theme.color.surfaceMuted : '#ECE8FC',
        }}
      />
      <Ionicons
        name="leaf"
        size={40}
        color={dark ? '#5A52A8' : '#B9AEF5'}
        style={{ position: 'absolute', bottom: 18, left: '18%', transform: [{ rotate: '-35deg' }] }}
      />
      <Ionicons
        name="leaf"
        size={40}
        color={dark ? '#5A52A8' : '#B9AEF5'}
        style={{ position: 'absolute', bottom: 18, right: '18%', transform: [{ rotate: '35deg' }] }}
      />
      {/* The ticket, half out of the box. */}
      <View
        style={{
          position: 'absolute',
          top: 18,
          left: '50%',
          marginLeft: -20,
          width: 76,
          height: 50,
          borderRadius: 8,
          backgroundColor: dark ? theme.color.surface : '#FFFFFF',
          transform: [{ rotate: '-24deg' }],
          padding: 8,
          gap: 5,
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.14,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <View style={{ width: 30, height: 4, borderRadius: 2, backgroundColor: '#D6CFFA' }} />
        <View style={{ width: 24, height: 4, borderRadius: 2, backgroundColor: '#D6CFFA' }} />
        <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: '#D6CFFA' }} />
        <Ionicons
          name="star"
          size={20}
          color="#F5B82E"
          style={{ position: 'absolute', right: 8, top: 12 }}
        />
      </View>
      <Ionicons name="gift" size={112} color={dark ? '#8C7FF0' : '#7B63EE'} />
      <Ionicons
        name="sparkles"
        size={16}
        color="#F5B82E"
        style={{ position: 'absolute', top: 10, right: '28%' }}
      />
      <Ionicons
        name="star"
        size={12}
        color="#F5B82E"
        style={{ position: 'absolute', top: 58, right: '26%' }}
      />
      <View
        style={{
          position: 'absolute',
          top: 34,
          right: '31%',
          width: 5,
          height: 12,
          borderRadius: 2,
          backgroundColor: '#7B63EE',
          transform: [{ rotate: '40deg' }],
        }}
      />
    </View>
  );
}
