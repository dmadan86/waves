/**
 * The entry to the paid tiers, and the boundary they never cross.
 *
 * The ledger is free forever; the only thing Waves charges for is convenience.
 * Splitting a bill, settling it, seeing what you owe and being owed are not
 * features to be taken away and sold back.
 *
 * Two states. Where the paywall is live (the `paywall` flag on, and a build
 * with a RevenueCat key), the hero names Plus and Pro, says which one the
 * person is on, and opens `/paywall`. Everywhere else there is nothing to buy,
 * and the screen says so: a price list for something that cannot be bought
 * would teach somebody something that is not true. The three cards' chevrons
 * open the card to its whole sentence either way.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, View } from 'react-native';

import {
  Button,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { PlanTier } from '@waves/core';

import { fill, useStrings, type UiStrings } from '@/i18n';
import { useFlagEnabled } from '@/lib/flags';
import { router } from '@/lib/navigation';
import { purchasesAvailable } from '@/lib/purchases';
import { useEntitlement } from '@/lib/useEntitlement';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

type IconName = keyof typeof Ionicons.glyphMap;

/** The mockup's inks in the light theme; the theme's own in the dark. */
function useUpgradeInks() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return {
    dark,
    ink: dark ? theme.color.text : SPEC_INK,
    muted: dark ? theme.color.textMuted : SPEC_MUTED,
    accent: dark ? theme.color.brand : SPEC_ACCENT,
    line: dark ? theme.color.border : '#DCD8F0',
  };
}

/** What a paid tier would be for, and what it would never touch. */
function cards(
  t: UiStrings,
): { icon: IconName; fg: string; bg: string; title: string; body: string }[] {
  return [
    {
      icon: 'scan-outline',
      fg: '#6845E8',
      bg: '#FBEAF6',
      title: t.upgradeScreen.moreScans,
      body: t.upgradeScreen.moreScansBody,
    },
    {
      icon: 'cloud-upload-outline',
      fg: '#2F6FE4',
      bg: '#E7F0FE',
      title: t.upgradeScreen.biggerTransfers,
      body: t.upgradeScreen.biggerTransfersBody,
    },
    {
      icon: 'lock-closed-outline',
      fg: '#1F8A6A',
      bg: '#E3F6EF',
      title: t.upgradeScreen.whatNeverWill,
      body: t.upgradeScreen.whatNeverWillBody.replace('{free}', t.freeForever.toLowerCase()),
    },
  ];
}

export default function UpgradeScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { dark, ink, muted, accent, line } = useUpgradeInks();
  const [open, setOpen] = useState<string | null>(null);
  const plansLive = useFlagEnabled('paywall') && purchasesAvailable();
  const { tier, isPaid } = useEntitlement();
  const heroTitle = !plansLive
    ? t.upgradeScreen.nothingToBuy
    : isPaid
      ? fill(t.upgradeScreen.onPlan, {
          plan: tier === PlanTier.Pro ? t.paywall.proTitle : t.paywall.plusTitle,
        })
      : t.upgradeScreen.plansTitle;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: ink }}>{t.upgrade}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.sm,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={
            dark
              ? [theme.color.surface, theme.color.surfaceMuted]
              : ['#FFFFFF', '#F1EEFD', '#E6E0FB']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 22,
            paddingVertical: 18,
            paddingLeft: 18,
            paddingRight: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            overflow: 'hidden',
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
            <Text style={{ fontSize: 21, fontWeight: '800', color: ink }}>{heroTitle}</Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: muted }}>
              {plansLive ? t.upgradeScreen.plansBody : t.upgradeScreen.nothingToBuyBody}
            </Text>
            {plansLive ? (
              <View style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                <Button
                  label={t.upgradeScreen.seePlans}
                  variant="brand"
                  size="sm"
                  onPress={() => router.push('/paywall')}
                />
              </View>
            ) : null}
          </View>
          <DoorArt />
        </LinearGradient>

        <Text style={{ fontSize: 16, fontWeight: '700', color: ink, marginTop: 6 }}>
          {plansLive ? t.upgradeScreen.whatCosts : t.upgradeScreen.whatWouldCost}
        </Text>

        {cards(t).map((card) => {
          const expanded = open === card.title;
          return (
            <Pressable
              key={card.title}
              accessibilityRole="button"
              accessibilityLabel={card.title}
              accessibilityHint={card.body}
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : card.title)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 14,
                borderRadius: 18,
                backgroundColor: theme.color.surface,
                opacity: pressed ? 0.9 : 1,
                shadowColor: '#2A1E6B',
                shadowOpacity: dark ? 0 : 0.06,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              })}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: dark ? theme.color.surfaceMuted : card.bg,
                }}
              >
                <Ionicons name={card.icon} size={26} color={card.fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>{card.title}</Text>
                <Text
                  numberOfLines={expanded ? undefined : 2}
                  style={{ fontSize: 13, lineHeight: 18, color: muted }}
                >
                  {card.body}
                </Text>
              </View>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surfaceMuted,
                }}
              >
                <Ionicons
                  name={expanded ? 'chevron-down' : directionalIcon('chevron-forward')}
                  size={15}
                  color={muted}
                />
              </View>
            </Pressable>
          );
        })}

        {/* Last, and quiet. There is nothing to buy, so a code is the only way
            in — but a big button for it on the screen that says "nothing to
            buy" reads as a shop after all. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.promo.row}
          accessibilityHint={t.promo.rowHint}
          onPress={() => router.push('/settings/redeem')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: line,
            borderStyle: 'dashed',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="ticket-outline" size={18} color={accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: accent }}>{t.promo.row}</Text>
            <Text style={{ fontSize: 12, color: muted }}>{t.promo.rowHint}</Text>
          </View>
          <Ionicons name={directionalIcon('chevron-forward')} size={16} color={accent} />
        </Pressable>

        <Row style={{ alignItems: 'center', gap: 10, marginTop: 4 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: line }} />
          <Ionicons name="shield-checkmark-outline" size={16} color={muted} />
          <Text style={{ fontSize: 12, color: muted }}>
            {plansLive ? t.upgradeScreen.plansPromise : t.upgradeScreen.promise}
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: line }} />
        </Row>
      </ScrollView>
    </Screen>
  );
}

/** The hero's picture: a door standing ajar on warm light, a mat, two leaves
 *  and a couple of sparkles. Drawn from views and glyphs, so it themes and
 *  costs no asset. */
function DoorArt() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const frame = dark ? '#4A4290' : '#C7BEF6';
  const door = dark ? '#6A5FC8' : '#9A8BF0';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 112, height: 120 }}
    >
      {/* Frame, with the light coming through it. */}
      <View
        style={{
          position: 'absolute',
          left: 30,
          bottom: 16,
          width: 60,
          height: 92,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          backgroundColor: frame,
          padding: 6,
          paddingBottom: 0,
        }}
      >
        <LinearGradient
          colors={dark ? ['#8C7A4A', '#3A3470'] : ['#FFF6DE', '#FFFFFF']}
          style={{ flex: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4 }}
        />
      </View>
      {/* The door, swung in towards the viewer. */}
      <View
        style={{
          position: 'absolute',
          left: 28,
          bottom: 14,
          width: 32,
          height: 84,
          borderRadius: 4,
          backgroundColor: door,
          transform: [{ perspective: 260 }, { rotateY: '-38deg' }, { translateX: -4 }],
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.18,
          shadowRadius: 6,
          shadowOffset: { width: 2, height: 3 },
          elevation: 3,
        }}
      >
        <View
          style={{
            position: 'absolute',
            right: 5,
            top: 40,
            width: 3,
            height: 9,
            borderRadius: 2,
            backgroundColor: '#FFE7A8',
          }}
        />
        <Ionicons
          name="sparkles"
          size={11}
          color="#FFE7A8"
          style={{ position: 'absolute', left: 9, top: 16 }}
        />
      </View>
      {/* Mat. */}
      <View
        style={{
          position: 'absolute',
          left: 36,
          bottom: 8,
          width: 50,
          height: 8,
          borderRadius: 3,
          backgroundColor: dark ? '#6B5A48' : '#E4D3BF',
          transform: [{ rotate: '-4deg' }],
        }}
      />
      <Ionicons
        name="leaf"
        size={30}
        color={dark ? '#3F8C7A' : '#5FAE9C'}
        style={{ position: 'absolute', left: 4, bottom: 12, transform: [{ rotate: '-30deg' }] }}
      />
      <Ionicons
        name="leaf"
        size={34}
        color={dark ? '#5A52A8' : '#8E80EE'}
        style={{ position: 'absolute', right: 0, bottom: 14, transform: [{ rotate: '25deg' }] }}
      />
      <Ionicons
        name="sparkles"
        size={12}
        color="#F5B82E"
        style={{ position: 'absolute', left: 12, top: 30 }}
      />
      <Ionicons
        name="sparkles"
        size={10}
        color="#F5B82E"
        style={{ position: 'absolute', right: 4, top: 14 }}
      />
    </View>
  );
}
