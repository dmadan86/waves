import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { VOICE_AGENT_PRO_MONTHLY } from '@waves/core';
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
  const blocked = !status?.canWatch || !!watchBlocked(status) || failedAvailability;
  const circle = (name: 'flash' | 'checkmark' | 'play', bg: string, ink: string, size = 64) => (
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
          <Text variant="heading" style={{ flex: 1 }}>
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
            <View
              style={{
                ...card,
                backgroundColor: c.brandSoft,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              {circle('flash', c.brandSoft, c.brand)}
              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <Text variant="heading">
                  {t.credits.sheetLeft.split('{n}').map((part, i) => (
                    <Text key={i} variant="heading" style={{ fontWeight: '700' }}>
                      {i > 0 ? (
                        <Text variant="heading" style={{ color: c.brand, fontWeight: '700' }}>
                          {status?.credits ?? 0}
                        </Text>
                      ) : null}
                      {part}
                    </Text>
                  ))}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.credits.sheetHelp}
                </Text>
              </View>
            </View>
            {blocked ? (
              <View
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                accessibilityLabel={`${t.credits.sheetUnavailable}. ${t.credits.sheetRetry}`}
                style={{
                  ...card,
                  backgroundColor: c.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                {circle('play', c.surfaceMuted, c.textFaint, 40)}
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Text style={{ fontWeight: '700', color: c.textMuted }}>
                    {t.credits.sheetUnavailable}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t.credits.sheetRetry}
                  </Text>
                </View>
              </View>
            ) : (
              <Button
                fullWidth
                size="lg"
                disabled={busy}
                label={fill(t.credits.sheetWatch, { n: status?.perAd ?? 0 })}
                icon={<Ionicons name="play-circle" size={24} color={c.onButtonPrimary} />}
                onPress={onWatch}
              />
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
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              {crown()}
              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <Text style={{ fontWeight: '700' }}>{t.rewardedAds.goPro}</Text>
                <Text variant="caption" tone="muted">
                  {fill(t.credits.sheetPro, { n: VOICE_AGENT_PRO_MONTHLY })}
                </Text>
              </View>
              <Ionicons name={directionalIcon('chevron-forward')} size={22} color={c.textMuted} />
            </Pressable>
            {busy ? (
              <View
                accessibilityLiveRegion="polite"
                style={{ flexDirection: 'row', gap: theme.spacing.sm }}
              >
                <ActivityIndicator color={c.brand} />
                <Text variant="caption">
                  {state.confirming ? t.rewardedAds.confirming : t.rewardedAds.preparing}
                </Text>
              </View>
            ) : null}
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
