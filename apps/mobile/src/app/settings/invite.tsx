/**
 * "Invite your friends": a personal link, and what it has earned so far.
 *
 * A useful part of sharing expenses, not a game. The friend gets 50 credits
 * and so do you, once they have actually used Waves (a verified account and a
 * real expense in a group of two or more); an install on its own earns nothing,
 * and nothing here asks for a rating or a review. The server decides all of it
 * (`waves_my_referral`, `waves_claim_referral`); this screen shows the link, the
 * share sheet, "N of 10 friends joined · X credits earned" and how many friends are still on their way.
 *
 * Hidden entirely where Pro cannot be bought (the same `plansLive` condition
 * as the upgrade screen: the row that leads here is not drawn, and the screen
 * itself shows nothing if reached anyway); it keeps the gate it always had.
 */

import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import {
  Button,
  Callout,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Skeleton,
  Text,
  useTabBarClearance,
  useTheme,
  type Theme,
} from '@waves/ui';

import { claimReferral, fetchMyReferral } from '@/data/api';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import {
  friendsJoinedText,
  normalizeReferralCode,
  referralLink,
  referralShareText,
  type ClaimOutcome,
} from '@/lib/referral';
import { useReferralsLive } from '@/lib/useReferralsLive';

const HERO_ART = require('../../../assets/images/invite/invite-hero.webp') as number;
const GIFT_ART = require('../../../assets/images/invite/invite-gift.webp') as number;
const HILLS_ART = require('../../../assets/images/invite/invite-hills.webp') as number;

function refusalText(reason: Extract<ClaimOutcome, { ok: false }>['reason'], t: UiStrings): string {
  switch (reason) {
    case 'UNKNOWN_CODE':
      return t.referral.unknownCode;
    case 'SELF_REFERRAL':
      return t.referral.ownCode;
    case 'ALREADY_CLAIMED':
      return t.referral.alreadyUsed;
    case 'NOT_NEW_USER':
      return t.referral.notNew;
    default:
      return t.referral.couldNotApply;
  }
}

export default function InviteFriendsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const { t, locale } = useStrings();
  const live = useReferralsLive();
  const viewerId = useViewerId();
  const queryClient = useQueryClient();

  const mine = useQuery({
    queryKey: ['myReferral', viewerId],
    enabled: live && viewerId !== null,
    staleTime: 60_000,
    queryFn: fetchMyReferral,
  });

  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(
    null,
  );
  const apply = useMutation({
    mutationFn: async (): Promise<void> => {
      const normalized = normalizeReferralCode(code);
      if (!normalized) {
        setNotice({ tone: 'negative', text: t.referral.unknownCode });
        return;
      }
      try {
        const outcome = await claimReferral(normalized);
        if (outcome.ok) {
          setNotice({ tone: 'positive', text: t.referral.applied });
          setCode('');
          void queryClient.invalidateQueries({ queryKey: ['myReferral', viewerId] });
        } else {
          setNotice({ tone: 'negative', text: refusalText(outcome.reason, t) });
        }
      } catch (caught) {
        setNotice({
          tone: 'negative',
          text: friendlyError(caught, t.referral.couldNotApply, 'referral.claim'),
        });
      }
    },
  });

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyCode = async (value: string): Promise<void> => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
    } catch {
      // Copy is a convenience; the share button still works.
    }
  };

  const data = mine.data ?? null;
  const link = data ? referralLink(data.code) : null;
  const share = async (): Promise<void> => {
    if (!link) return;
    await Share.share({
      message: referralShareText(t.referral.shareMessage, link),
      title: t.referral.title,
    });
  };

  const skyTop = theme.scheme === 'dark' ? '#1B2A44' : '#BFDFF7';
  const skyMid = theme.scheme === 'dark' ? '#1F2140' : '#E4E9FB';

  return (
    <Screen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: insets.top }}>
          <LinearGradient
            colors={[skyTop, skyMid, theme.color.bg]}
            locations={[0, 0.55, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <Image
            source={HERO_ART}
            accessibilityIgnoresInvertColors
            importantForAccessibility="no"
            accessible={false}
            resizeMode="contain"
            style={{ position: 'absolute', end: 0, bottom: 0, width: 138, height: 128 }}
          />
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
            <IconButton label={t.common.back} onPress={() => router.back()}>
              <Ionicons
                name={directionalIcon('chevron-back')}
                size={iconSize.lg}
                color={theme.color.text}
              />
            </IconButton>
            <View style={{ maxWidth: '62%', gap: theme.spacing.xs }}>
              <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '800' }}>
                {t.referral.title}{' '}
                <View accessibilityElementsHidden importantForAccessibility="no">
                  <Sparkle color={theme.color.brand} />
                </View>
              </Text>
              <View style={{ gap: 2 }}>
                <Text variant="subheading" style={{ fontWeight: '700' }}>
                  {t.referral.headline}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.referral.body}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {!live ? null : (
          <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
            {mine.isPending ? (
              <Skeleton height={40} radius={theme.radius.lg} />
            ) : data ? (
              <>
                {data.code ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      height: 40,
                      paddingStart: theme.spacing.md,
                      paddingEnd: theme.spacing.xs,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.color.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.color.border,
                    }}
                  >
                    <Text variant="caption" tone="muted">
                      {t.referral.yourCode}
                    </Text>
                    <Text
                      selectable
                      style={{
                        flex: 1,
                        fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
                        fontWeight: '700',
                        letterSpacing: 2,
                      }}
                    >
                      {data.code}
                    </Text>
                    {copied ? (
                      <Text variant="caption" tone="brand" accessibilityLiveRegion="polite">
                        {t.referral.codeCopied}
                      </Text>
                    ) : null}
                    <IconButton
                      label={t.referral.copyCode}
                      onPress={() => void copyCode(data.code)}
                    >
                      <Ionicons
                        name={copied ? 'checkmark' : 'copy-outline'}
                        size={iconSize.md}
                        color={copied ? theme.color.brand : theme.color.text}
                      />
                    </IconButton>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t.referral.share}
                  onPress={() => void share()}
                  style={({ pressed }) => ({
                    borderRadius: theme.radius.pill,
                    overflow: 'hidden',
                    opacity: pressed ? 0.88 : 1,
                  })}
                >
                  <LinearGradient
                    colors={theme.gradient.brand as unknown as [string, string, ...string[]]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={{
                      height: 48,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      paddingHorizontal: 20,
                    }}
                  >
                    <Ionicons name="share-outline" size={iconSize.lg} color={theme.color.onBrand} />
                    <Text variant="subheading" style={{ color: theme.color.onBrand }}>
                      {t.referral.share}
                    </Text>
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.md}
                      color={theme.color.onBrand}
                      style={{ position: 'absolute', end: 18 }}
                    />
                  </LinearGradient>
                </Pressable>

                <View
                  style={[
                    panel(theme),
                    { padding: theme.spacing.md, gap: theme.spacing.sm, overflow: 'hidden' },
                  ]}
                >
                  <Image
                    source={GIFT_ART}
                    accessibilityIgnoresInvertColors
                    importantForAccessibility="no"
                    accessible={false}
                    resizeMode="contain"
                    style={{ position: 'absolute', top: 0, end: 0, width: 88, height: 40 }}
                  />
                  <Text variant="subheading">
                    {friendsJoinedText(data, t.referral.friendsJoined)}
                  </Text>
                  {data.pending > 0 ? (
                    <Text variant="caption" tone="muted">
                      {plural(locale, data.pending, t.referral.pending)}
                    </Text>
                  ) : null}
                </View>
              </>
            ) : (
              <Callout tone="warning">{t.referral.loadError}</Callout>
            )}

            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="subheading">{t.referral.haveCode}</Text>
              <Row style={{ gap: 8 }}>
                <View
                  style={{
                    flex: 1,
                    height: 40,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    backgroundColor: theme.color.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.color.border,
                  }}
                >
                  <Ionicons
                    name="ticket-outline"
                    size={iconSize.lg}
                    color={theme.color.textFaint}
                  />
                  <TextInput
                    value={code}
                    onChangeText={(next) => {
                      setCode(next.toUpperCase());
                      setNotice(null);
                    }}
                    placeholder="ABCD2345"
                    placeholderTextColor={theme.color.textFaint}
                    accessibilityLabel={t.referral.haveCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    maxLength={12}
                    style={{
                      flex: 1,
                      height: 40,
                      padding: 0,
                      color: theme.color.text,
                      fontSize: 16,
                      letterSpacing: 1,
                    }}
                  />
                </View>
                <Button
                  label={t.referral.apply}
                  variant="brand"
                  size="sm"
                  disabled={apply.isPending || normalizeReferralCode(code) === null}
                  onPress={() => apply.mutate()}
                />
              </Row>
              {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
            </View>
          </View>
        )}

        <Image
          source={HILLS_ART}
          accessibilityIgnoresInvertColors
          importantForAccessibility="no"
          accessible={false}
          resizeMode="cover"
          style={{ width: '100%', height: 56, marginTop: 4 }}
        />
      </ScrollView>
    </Screen>
  );
}

/** A white rounded card, the surface the rows and the progress sit on. */
function panel(theme: Theme): ViewStyle {
  return {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.xl,
    ...theme.shadow.soft,
  };
}

function Sparkle({ color }: { color: string }) {
  return (
    <Svg width={16} height={18} viewBox="0 0 16 18" fill="none">
      <Path d="M5 2.5 L12 4" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M7 8.5 L14 8.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M5 14.5 L12 13" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
