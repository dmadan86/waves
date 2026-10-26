import { logAdEvent, noteAdFailure } from '@/lib/adEvents';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image, Platform, Text as NativeText, View } from 'react-native';
import type { ViewProps } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@waves/ui';
import { useStrings } from '@/i18n';
import { useEntitlement } from '@/lib/useEntitlement';
import { useViewerId } from '@/lib/auth';
import { useFlagEnabled } from '@/lib/flags';
import { loadAdsSdk } from '@/lib/adsSdk';
import { readGateStatus } from '@/lib/adGates';
import { ADS_REQUEST_CONFIGURATION } from '@/lib/rewardedAdsPure';
import { gatherConsentSafe } from '@/lib/rewardedAd';
import {
  nativeEligible,
  nativeUnitId,
  nativeCapacityAvailable,
  nativeDailyCap,
} from '@/lib/nativeAdsPure';

// Pending ads reserve capacity only in memory; only SDK impressions survive remounts.
let counterQueue = Promise.resolve();
const pending = new Map<string, number>();
async function reserve(profileId: string, cap?: number | null) {
  let reservation: { release(): void; record(): Promise<void> } | undefined;
  const work = counterQueue.then(async () => {
    const key = `waves.nativeImpressions.${profileId}.${new Date().toISOString().slice(0, 10)}`;
    const count = Number((await AsyncStorage.getItem(key)) ?? 0);
    const held = pending.get(key) ?? 0;
    if (!nativeCapacityAvailable(count, held, cap)) return;
    pending.set(key, held + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      pending.set(key, Math.max(0, (pending.get(key) ?? 1) - 1));
    };
    reservation = {
      release,
      record: () => {
        const write = counterQueue
          .then(async () => {
            const impressions = Number((await AsyncStorage.getItem(key)) ?? 0);
            await AsyncStorage.setItem(key, String(impressions + 1));
          })
          .finally(release);
        counterQueue = write.catch(() => undefined);
        return write;
      },
    };
  });
  counterQueue = work.catch(() => undefined);
  await work;
  return reservation;
}

type NativeAd = {
  headline: string;
  body: string;
  callToAction?: string;
  icon?: { url: string } | null;
  images?: { url: string }[];
  mediaContent?: { hasVideoContent: boolean } | null;
  addAdEventListener(event: string, callback: () => void): { remove(): void };
  destroy(): void;
};
type NativeSdk = {
  NativeAdEventType: { IMPRESSION: string };
  NativeAd: { createForAdRequest(id: string, options: object): Promise<NativeAd> };
  NativeAdView: React.ComponentType<ViewProps & { nativeAd: NativeAd }>;
  NativeAsset: React.ComponentType<React.PropsWithChildren<{ assetType: string }>>;
  NativeAssetType: { ICON: string; HEADLINE: string; BODY: string; CALL_TO_ACTION: string };
};

export function NativeAdCard({
  visible,
  rowGap,
  precedingGap = 0,
}: {
  visible: boolean;
  rowGap: number;
  precedingGap?: number;
}) {
  const viewerId = useViewerId();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const { isPaid } = useEntitlement();
  const enabled = useFlagEnabled('ads_native');
  const { t } = useStrings();
  const theme = useTheme();
  const gate = useQuery({
    queryKey: ['bannerGate', viewerId],
    queryFn: () => readGateStatus(viewerId!),
    enabled: !!viewerId && enabled,
    staleTime: 5 * 60_000,
  });
  const eligible = nativeEligible(!!viewerId && !isPaid, enabled, gate.data, 0);
  const [loaded, setLoaded] = useState<{ sdk: NativeSdk; ad: NativeAd } | null>(null);
  useEffect(() => {
    if (!eligible || !viewerId || !visible || !focused || Platform.OS === 'web') return;
    let cancelled = false;
    let ad: NativeAd | undefined;
    let reservation: Awaited<ReturnType<typeof reserve>>;
    let impression: { remove(): void } | undefined;
    void (async () => {
      try {
        // Fresh server verdict immediately before loading: never request for paid users.
        const current = await readGateStatus(viewerId).catch(() => null);
        if (cancelled || !nativeEligible(true, enabled, current, 0)) return;
        const sdk = await loadAdsSdk();
        const consent = await gatherConsentSafe(sdk);
        if (cancelled || !consent.canRequestAds) return;
        await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
        await sdk.MobileAds().initialize();
        if (cancelled) return;
        reservation = await reserve(viewerId, nativeDailyCap(current));
        if (cancelled || !reservation) {
          reservation?.release();
          return;
        }
        const native = (await import('react-native-google-mobile-ads')) as unknown as NativeSdk;
        ad = await native.NativeAd.createForAdRequest(
          nativeUnitId(
            Platform.OS,
            Platform.OS === 'ios'
              ? process.env.EXPO_PUBLIC_ADMOB_NATIVE_IOS
              : process.env.EXPO_PUBLIC_ADMOB_NATIVE_ANDROID,
            __DEV__,
          ),
          { requestNonPersonalizedAdsOnly: true },
        );
        if (cancelled) {
          ad.destroy();
          reservation.release();
          return;
        }
        // AdMob requires a MediaView for video ads; this compact row cannot show them.
        if (ad.mediaContent?.hasVideoContent) {
          ad.destroy();
          ad = undefined;
          reservation.release();
          return;
        }
        let reported = false;
        impression = ad.addAdEventListener(native.NativeAdEventType.IMPRESSION, () => {
          if (!reported) {
            reported = true;
            void reservation?.record().catch(noteAdFailure);
            logAdEvent(viewerId, 'native_list', 'shown');
          }
        });
        if (cancelled) ad.destroy();
        else setLoaded({ sdk: native, ad });
      } catch (error) {
        reservation?.release();
        noteAdFailure(error);
        logAdEvent(viewerId, 'native_list', 'failed');
        /* No fill, unavailable native module or storage failure: omit the card. */
      }
    })();
    return () => {
      cancelled = true;
      reservation?.release();
      impression?.remove();
      ad?.destroy();
      setLoaded(null);
    };
  }, [eligible, enabled, viewerId, visible, focused]);
  if (!eligible || !visible || !focused || !loaded) return null;
  const { sdk, ad } = loaded;
  const icon = ad.icon ?? ad.images?.[0];
  return (
    <View style={{ paddingTop: Math.max(0, rowGap - precedingGap), paddingBottom: rowGap }}>
      <sdk.NativeAdView
        nativeAd={ad}
        style={{
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          overflow: 'hidden',
          elevation: 0,
          shadowOpacity: 0,
        }}
      >
        <View
          style={{
            backgroundColor: 'transparent',
            padding: theme.spacing.sm,
            // Keep the SDK's top-right AdChoices overlay clear of row content.
            paddingRight: theme.spacing.xl,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          {icon ? (
            <sdk.NativeAsset assetType={sdk.NativeAssetType.ICON}>
              <Image
                source={{ uri: icon.url }}
                style={{ width: 40, height: 40, borderRadius: theme.radius.sm }}
              />
            </sdk.NativeAsset>
          ) : (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.sm,
                backgroundColor: theme.color.border,
              }}
            />
          )}
          <View style={{ flex: 1, gap: theme.spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
              <NativeText
                style={{
                  color: theme.color.textMuted,
                  fontSize: 10,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: theme.spacing.xs,
                  paddingVertical: 1,
                }}
              >
                {t.rewardedAds.adLabel}
              </NativeText>
              <sdk.NativeAsset assetType={sdk.NativeAssetType.HEADLINE}>
                <NativeText
                  numberOfLines={1}
                  style={{ flex: 1, color: theme.color.text, fontWeight: '600' }}
                >
                  {ad.headline}
                </NativeText>
              </sdk.NativeAsset>
            </View>
            <sdk.NativeAsset assetType={sdk.NativeAssetType.BODY}>
              <NativeText numberOfLines={1} style={{ color: theme.color.textMuted, fontSize: 12 }}>
                {ad.body}
              </NativeText>
            </sdk.NativeAsset>
          </View>
          {ad.callToAction ? (
            <sdk.NativeAsset assetType={sdk.NativeAssetType.CALL_TO_ACTION}>
              <NativeText
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  maxWidth: '30%',
                  color: '#FFFFFF',
                  backgroundColor: theme.color.brand,
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                {ad.callToAction}
              </NativeText>
            </sdk.NativeAsset>
          ) : null}
        </View>
      </sdk.NativeAdView>
    </View>
  );
}
