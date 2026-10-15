/**
 * "Invite your friends": a personal link, and what it has earned so far.
 *
 * A useful part of sharing expenses, not a game. The friend gets 7 days of Plus
 * and so do you, once they have actually used Waves (a verified account and a
 * real expense in a group of two or more); an install on its own earns nothing,
 * and nothing here asks for a rating or a review. The server decides all of it
 * (`waves_my_referral`, `waves_claim_referral`); this screen shows the link, the
 * share sheet, "X of 30 days earned" and how many friends are still on their way.
 *
 * Hidden entirely where Plus cannot be bought (the same `plansLive` condition
 * as the upgrade screen: the row that leads here is not drawn, and the screen
 * itself shows nothing if reached anyway), because a reward in days of a plan that cannot be
 * used would be a promise about nothing.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, ScrollView, Share, TextInput, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { claimReferral, fetchMyReferral } from '@/data/api';
import { plural, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';
import {
  daysEarnedText,
  daysFraction,
  normalizeReferralCode,
  referralLink,
  referralShareText,
  type ClaimOutcome,
} from '@/lib/referral';
import { useReferralsLive } from '@/lib/useReferralsLive';

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

  const data = mine.data ?? null;
  const link = data ? referralLink(data.code) : null;
  const share = async (): Promise<void> => {
    if (!link) return;
    await Share.share({
      message: referralShareText(t.referral.shareMessage, link),
      title: t.referral.title,
    });
  };

  const fraction = data ? daysFraction(data) : 0;

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="title">{t.referral.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          paddingTop: theme.spacing.md,
          gap: 12,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!live ? null : (
          <>
            <View style={{ gap: 4 }}>
              <Text variant="heading">{t.referral.headline}</Text>
              <Text tone="muted">{t.referral.body}</Text>
            </View>

            <Card>
              <View style={{ gap: 10 }}>
                <Row style={{ gap: 10, alignItems: 'flex-start' }}>
                  <Ionicons name="gift-outline" size={iconSize.md} color={theme.color.brand} />
                  <Text style={{ flex: 1 }}>{t.referral.youGet}</Text>
                </Row>
                <Row style={{ gap: 10, alignItems: 'flex-start' }}>
                  <Ionicons name="people-outline" size={iconSize.md} color={theme.color.brand} />
                  <Text style={{ flex: 1 }}>{t.referral.friendGets}</Text>
                </Row>
              </View>
            </Card>

            {mine.isPending ? (
              <ActivityIndicator color={theme.color.brand} />
            ) : data ? (
              <>
                <Button label={t.referral.share} onPress={() => void share()} fullWidth />
                <Card>
                  <View style={{ gap: 8 }}>
                    <Text variant="subheading">
                      {daysEarnedText(data, {
                        progress: t.referral.progress,
                        capReached: t.referral.capReached,
                      })}
                    </Text>
                    <View
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: data.daysCap, now: data.daysEarned }}
                      style={{
                        height: 8,
                        borderRadius: 4,
                        overflow: 'hidden',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <View
                        style={{
                          height: 8,
                          width: `${Math.round(fraction * 100)}%`,
                          backgroundColor: theme.color.brand,
                        }}
                      />
                    </View>
                    {data.pending > 0 ? (
                      <Text variant="caption" tone="muted">
                        {plural(locale, data.pending, t.referral.pending)}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              </>
            ) : (
              <Callout tone="warning">{t.referral.loadError}</Callout>
            )}

            <View style={{ gap: 8, marginTop: 4 }}>
              <Text variant="caption" tone="muted">
                {t.referral.haveCode}
              </Text>
              <Row style={{ gap: 8 }}>
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
                    height: 44,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.surface,
                    color: theme.color.text,
                    fontSize: 16,
                    letterSpacing: 1,
                  }}
                />
                <Button
                  label={t.referral.apply}
                  variant="secondary"
                  disabled={apply.isPending || normalizeReferralCode(code) === null}
                  onPress={() => apply.mutate()}
                />
              </Row>
              {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
