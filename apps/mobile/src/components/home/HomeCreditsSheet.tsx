import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { PRO_DEVICE_LIMIT, PRO_MONTHLY_SCANS, VOICE_AGENT_PRO_MONTHLY } from '@waves/core';
import { Button, Callout, directionalIcon, Sheet, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import type { AdSheetState } from '@/components/RewardedAdSheet';
import { watchBlocked, type CreditsStatus } from '@/lib/adCreditsPure';
import { useFlagEnabled } from '@/lib/flags';
import { planCardsFromOffering } from '@/lib/pricing';
import { loadOffering, purchasesAvailable } from '@/lib/purchases';

export function HomeCreditsSheet({
  visible,
  status,
  state,
  onWatch,
  onUpgrade,
  onClose,
  onClosed,
}: {
  visible: boolean;
  status: CreditsStatus | null;
  state: AdSheetState;
  onWatch: () => void;
  onUpgrade: () => void;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  const c = theme.color;
  const [pro, setPro] = useState(false);
  const plansLive = useFlagEnabled('paywall') && purchasesAvailable();
  const loadKey = useMemo(() => ({ visible, pro, plansLive }), [visible, pro, plansLive]);
  const [priceResult, setPriceResult] = useState<{
    key: typeof loadKey;
    price: string | undefined;
  }>();
  const price = priceResult?.key === loadKey ? priceResult.price : undefined;
  useEffect(() => {
    if (!loadKey.visible || !loadKey.pro || !loadKey.plansLive) return;
    let active = true;
    loadOffering()
      .then((offering) => {
        if (active) {
          setPriceResult({
            key: loadKey,
            price: planCardsFromOffering(offering, 'monthly')[0]?.priceString,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadKey]);
  const busy = state.step === 'busy';
  const success = state.step === 'result' && state.done && state.tone === 'positive';
  const failedAvailability =
    state.step === 'result' &&
    [t.rewardedAds.noFill, t.rewardedAds.offline, t.rewardedAds.unavailable].includes(
      state.message,
    );
  const full = status?.reason === 'wallet_full' || !!(status && status.credits >= status.walletCap);
  const gap = status?.reason === 'gap';
  const blocked = full || gap || !status?.canWatch || !!watchBlocked(status) || failedAvailability;
  const blockedTitle = full
    ? t.credits.sheetFull
    : gap
      ? t.credits.sheetGap
      : t.credits.sheetUnavailable;
  const blockedBody = full
    ? fill(t.credits.sheetFullBody, { n: status?.credits ?? 0, max: status?.walletCap ?? 0 })
    : gap
      ? undefined
      : t.credits.sheetRetry;
  const circle = (
    name: 'flash' | 'checkmark' | 'checkmark-circle' | 'play',
    bg: string,
    ink: string,
    size = 64,
  ) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={size / 2} color={ink} accessible={false} />
    </View>
  );
  const crown = (size = 56) => (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.warningSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons name="crown" size={size / 2} color={c.warning} accessible={false} />
    </View>
  );
  const card = { padding: theme.spacing.md, borderRadius: theme.radius.xl, gap: theme.spacing.sm };
  return (
    <Sheet
      visible={visible}
      onClose={busy ? () => undefined : onClose}
      onClosed={() => {
        setPro(false);
        onClosed?.();
      }}
      closeLabel={t.common.close}
    >
      <View style={{ gap: theme.spacing.md }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text variant="heading" style={{ flex: 1, fontSize: 28, fontWeight: '700' }}>
            {!success && !pro ? t.credits.sheetTitle : ''}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: c.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={24} color={c.textMuted} />
          </Pressable>
        </View>
        {success ? (
          <>
            <View
              accessibilityLiveRegion="polite"
              style={{
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingBottom: theme.spacing.lg,
              }}
            >
              <View
                style={{ width: 156, height: 110, alignItems: 'center', justifyContent: 'center' }}
              >
                {circle('checkmark', c.positiveSoft, c.positive, 88)}
                {[
                  [-2, 24],
                  [132, 8],
                  [146, 78],
                  [12, 92],
                ].map(([left, top], i) => (
                  <View
                    key={i}
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: i % 2 ? c.warning : c.brand,
                    }}
                  />
                ))}
              </View>
              <Text
                variant="heading"
                style={{ textAlign: 'center', fontSize: 28, fontWeight: '700' }}
              >
                {fill(t.credits.sheetAdded, { n: status?.perAd ?? 0 })}
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {fill(t.credits.sheetBalance, { n: status?.credits ?? 0 })}
              </Text>
            </View>
            <Button fullWidth size="lg" label={t.credits.sheetContinue} onPress={onClose} />
          </>
        ) : pro ? (
          <>
            <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              {crown(72)}
              <Text variant="heading">{t.rewardedAds.goPro}</Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {fill(t.credits.sheetProSubtitle, { n: VOICE_AGENT_PRO_MONTHLY })}
              </Text>
            </View>
            <View style={{ ...card, backgroundColor: c.brandSoft }}>
              {[
                t.planScreen.proFeatureNoAds,
                fill(t.credits.sheetVoice, { n: VOICE_AGENT_PRO_MONTHLY }),
              ].map((text) => (
                <View
                  key={text}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                >
                  {circle('checkmark', c.brand, c.onBrand, 24)}
                  <Text style={{ flex: 1 }}>{text}</Text>
                </View>
              ))}
            </View>
            <Button
              fullWidth
              size="lg"
              label={price ? fill(t.credits.sheetPrice, { price }) : t.rewardedAds.goPro}
              icon={<MaterialCommunityIcons name="crown" size={22} color={c.onButtonPrimary} />}
              onPress={onUpgrade}
            />
            <Button
              fullWidth
              variant="ghost"
              label={t.credits.sheetLater}
              onPress={() => setPro(false)}
            />
          </>
        ) : (
          <>
            <Text tone="muted" style={{ marginTop: -theme.spacing.xs }}>
              {t.credits.sheetHelp}
            </Text>
            <View
              style={{
                ...card,
                backgroundColor: c.brandSoft,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1, gap: theme.spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  {circle('flash', c.surface, c.brand, 52)}
                  <View>
                    <Text
                      variant="heading"
                      style={{ color: c.brand, fontSize: 34, lineHeight: 38, fontWeight: '700' }}
                    >
                      {status?.credits ?? 0}
                    </Text>
                    <Text style={{ fontWeight: '700' }}>
                      {t.credits.sheetLeft.replace('{n}', '').trim()}
                    </Text>
                  </View>
                </View>
                <Text variant="caption" tone="muted">
                  {(status?.credits ?? 0) > 0
                    ? t.credits.sheetStatusHas
                    : t.credits.sheetStatusEmpty}
                </Text>
              </View>
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 42,
                  backgroundColor: c.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="mic" size={44} color={c.brand} />
                <Ionicons
                  name="sparkles"
                  size={18}
                  color={c.warning}
                  style={{ position: 'absolute', top: 2, right: 0 }}
                />
                <Ionicons
                  name="sparkles"
                  size={12}
                  color={c.warning}
                  style={{ position: 'absolute', bottom: 8, left: 2 }}
                />
              </View>
            </View>
            {blocked && !busy ? (
              <View
                accessible
                accessibilityLabel={[blockedTitle, blockedBody].filter(Boolean).join('. ')}
                style={{
                  ...card,
                  backgroundColor: full ? c.positiveSoft : c.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                {circle(
                  full ? 'checkmark-circle' : 'play',
                  full ? c.positiveSoft : c.surfaceMuted,
                  full ? c.positive : c.textFaint,
                  40,
                )}
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Text style={{ fontWeight: '700', color: c.textMuted }}>{blockedTitle}</Text>
                  {blockedBody ? (
                    <Text variant="caption" tone="muted">
                      {blockedBody}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy, busy }}
                disabled={busy}
                onPress={onWatch}
                style={{
                  ...card,
                  backgroundColor: c.buttonPrimary,
                  flexDirection: 'row',
                  alignItems: 'center',
                  opacity: busy ? 0.85 : 1,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: c.onButtonPrimary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={c.buttonPrimary} />
                  ) : (
                    <Ionicons name="play" size={20} color={c.buttonPrimary} accessible={false} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontWeight: '700', color: c.onButtonPrimary }}>
                    {busy
                      ? state.confirming
                        ? t.rewardedAds.confirming
                        : t.rewardedAds.preparing
                      : fill(t.credits.sheetWatch, { n: status?.perAd ?? 0 })}
                  </Text>
                  <Text variant="caption" style={{ color: c.onButtonPrimary, opacity: 0.85 }}>
                    {t.credits.sheetWatchSub}
                  </Text>
                </View>
                <Ionicons
                  name={directionalIcon('chevron-forward')}
                  size={22}
                  color={c.onButtonPrimary}
                />
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.rewardedAds.goPro}. ${fill(t.credits.sheetPro, { n: VOICE_AGENT_PRO_MONTHLY })}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => setPro(true)}
              style={{
                ...card,
                backgroundColor: c.surface,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                {crown()}
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Text style={{ fontWeight: '700' }}>{t.rewardedAds.goPro}</Text>
                  <Text variant="caption" tone="muted">
                    {fill(t.credits.sheetPro, { n: VOICE_AGENT_PRO_MONTHLY })}
                  </Text>
                </View>
                <Ionicons name={directionalIcon('chevron-forward')} size={22} color={c.textMuted} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {[
                  [
                    'scan',
                    fill(t.credits.sheetMiniScans, { n: PRO_MONTHLY_SCANS }),
                    t.credits.sheetMiniScansSub,
                  ],
                  ['ban', t.credits.sheetMiniAds, t.credits.sheetMiniAdsSub],
                  [
                    'phone-portrait',
                    fill(t.credits.sheetMiniDevices, { n: PRO_DEVICE_LIMIT }),
                    t.credits.sheetMiniDevicesSub,
                  ],
                ].map(([icon, title, sub], i) => (
                  <View
                    key={icon}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingHorizontal: theme.spacing.xs,
                      gap: 2,
                      borderStartWidth: i ? 1 : 0,
                      borderStartColor: c.border,
                    }}
                  >
                    <Ionicons name={icon as 'scan'} size={18} color={c.brand} accessible={false} />
                    <Text variant="caption" style={{ fontWeight: '700', textAlign: 'center' }}>
                      {title}
                    </Text>
                    <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                      {sub}
                    </Text>
                  </View>
                ))}
              </View>
            </Pressable>
            {state.step === 'result' && !failedAvailability ? (
              <Callout tone={state.tone}>{state.message}</Callout>
            ) : null}
            <Button
              fullWidth
              label={t.rewardedAds.notNow}
              variant="ghost"
              disabled={busy}
              onPress={onClose}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}
