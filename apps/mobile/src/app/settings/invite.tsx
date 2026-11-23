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
  useTheme,
  useTabBarClearance,
  type Theme,
} from '@waves/ui';

import { claimReferral, fetchMyReferral } from '@/data/api';
import { fill, plural, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import {
  normalizeReferralCode,
  referralLink,
  referralShareText,
  rewardedFriendsText,
  type ClaimOutcome,
} from '@/lib/referral';
import { useReferralsLive } from '@/lib/useReferralsLive';

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
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const live = useReferralsLive();
  const viewerId = useViewerId();
  const queryClient = useQueryClient();

  const mine = useQuery({
    queryKey: ['myReferral', viewerId],
    // The RPC handles guest accounts too. Requiring a viewer id here leaves
    // TanStack Query in its pending state forever while auth is settling.
    enabled: live,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          fetchMyReferral(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Referral request timed out')), 8_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
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

  return (
    <Screen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: clearance }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: insets.top }}>
          <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
            <IconButton label={t.common.back} onPress={() => router.back()}>
              <Ionicons
                name={directionalIcon('chevron-back')}
                size={iconSize.lg}
                color={theme.color.text}
              />
            </IconButton>
            <View style={{ gap: theme.spacing.xs }}>
              <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '800' }}>
                {t.referral.title}
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
                      minHeight: 56,
                      paddingStart: theme.spacing.lg,
                      paddingEnd: theme.spacing.sm,
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
                    borderRadius: theme.radius.lg,
                    overflow: 'hidden',
                    opacity: pressed ? 0.88 : 1,
                  })}
                >
                  <View
                    style={[
                      { backgroundColor: theme.color.brand },
                      {
                        height: 48,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        paddingHorizontal: 20,
                      },
                    ]}
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
                  </View>
                </Pressable>

                {data.progressAvailable ? (
                  <View
                    style={[panel(theme), { padding: theme.spacing.lg, gap: theme.spacing.sm }]}
                  >
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                    >
                      <View style={{ flex: 1, gap: theme.spacing.xs }}>
                        <Text variant="subheading" style={{ fontWeight: '800' }}>
                          {fill(t.referral.creditsEarned, { credits: String(data.creditsEarned) })}
                        </Text>
                        <View
                          accessibilityRole="progressbar"
                          accessibilityValue={{
                            min: 0,
                            max: data.friendsCap,
                            now: Math.min(data.rewarded, data.friendsCap),
                          }}
                          accessibilityLabel={rewardedFriendsText(data, t.referral.rewardedCaption)}
                          style={{
                            height: 7,
                            borderRadius: theme.radius.pill,
                            backgroundColor: theme.color.brandSoft,
                            overflow: 'hidden',
                          }}
                        >
                          <View
                            style={{
                              width: `${data.friendsCap > 0 ? Math.min(data.rewarded / data.friendsCap, 1) * 100 : 0}%`,
                              height: '100%',
                              borderRadius: theme.radius.pill,
                              backgroundColor: theme.color.brand,
                            }}
                          />
                        </View>
                        <Text variant="caption" tone="muted">
                          {rewardedFriendsText(data, t.referral.rewardedCaption)}
                        </Text>
                      </View>
                      <Image
                        source={GIFT_ART}
                        accessibilityIgnoresInvertColors
                        importantForAccessibility="no"
                        accessible={false}
                        resizeMode="contain"
                        style={{ width: 60, height: 60 }}
                      />
                    </View>
                    {data.pending > 0 ? (
                      <Text variant="caption" tone="muted">
                        {plural(locale, data.pending, t.referral.pending)}
                      </Text>
                    ) : null}
                    {data.rewarded >= data.friendsCap ? (
                      <Text variant="caption" tone="muted">
                        {t.referral.capReached}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Callout tone="warning">{t.referral.loadError}</Callout>
                <Button label={t.retry} variant="secondary" onPress={() => void mine.refetch()} />
              </>
            )}

            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="subheading">{t.referral.haveCode}</Text>
              <Row style={{ gap: 8 }}>
                <View
                  style={{
                    flex: 1,
                    minHeight: 48,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.lg,
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
          style={{ width: '100%', aspectRatio: 849 / 188, marginTop: 'auto' }}
        />
      </ScrollView>
    </Screen>
  );
}

/** A white rounded card, the surface the rows and the progress sit on. */
function panel(theme: Theme): ViewStyle {
  return {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    ...theme.shadow.soft,
  };
}
