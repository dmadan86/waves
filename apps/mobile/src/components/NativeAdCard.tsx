import { logAdEvent, noteAdFailure } from '@/lib/adEvents';
import { useEffect, useState } from 'react';
import { Platform, Text as NativeText } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { Text, useTheme } from '@waves/ui';
import { StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import { useEntitlement } from '@/lib/useEntitlement';
import { useViewerId } from '@/lib/auth';
import { useFlagEnabled } from '@/lib/flags';
import { loadAdsSdk, readAdsStatus } from '@/lib/adsSdk';
import { ADS_REQUEST_CONFIGURATION } from '@/lib/rewardedAdsPure';
import { nativeEligible, nativeUnitId, NATIVE_DAILY_CAP } from '@/lib/nativeAdsPure';

// Serialize reservations across both screens. Reserve before requesting: failed
// requests consume a slot too, keeping the impression cap conservative after a crash.
let counterQueue = Promise.resolve();
async function reserve(profileId: string): Promise<boolean> {
  let allowed = false;
  const work = counterQueue.then(async () => {
    const key = `waves.nativeAds.${profileId}.${new Date().toISOString().slice(0, 10)}`;
    const count = Number((await AsyncStorage.getItem(key)) ?? 0);
    if (!Number.isInteger(count) || count < 0 || count >= NATIVE_DAILY_CAP) return;
    await AsyncStorage.setItem(key, String(count + 1));
    allowed = true;
  });
  counterQueue = work.catch(() => undefined);
  await work;
  return allowed;
}

type NativeAd = {
  headline: string;
  body: string;
  callToAction?: string;
  addAdEventListener(event: string, callback: () => void): { remove(): void };
  destroy(): void;
};
type NativeSdk = {
  NativeAdEventType: { IMPRESSION: string };
  NativeAd: { createForAdRequest(id: string, options: object): Promise<NativeAd> };
  NativeAdView: React.ComponentType<React.PropsWithChildren<{ nativeAd: NativeAd }>>;
  NativeAsset: React.ComponentType<React.PropsWithChildren<{ assetType: string }>>;
  NativeAssetType: { HEADLINE: string; BODY: string; CALL_TO_ACTION: string };
  NativeMediaView: React.ComponentType<{ style: { width: '100%'; height: number } }>;
};

export function NativeAdCard({ visible }: { visible: boolean }) {
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const enabled = useFlagEnabled('ads_native');
  const { t } = useStrings();
  const theme = useTheme();
  const status = useQuery({
    queryKey: ['adsStatus', viewerId],
    queryFn: readAdsStatus,
    enabled: !!viewerId && enabled,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const eligible = nativeEligible(!!viewerId && !isPaid, enabled, status.data, 0);
  const [loaded, setLoaded] = useState<{ sdk: NativeSdk; ad: NativeAd } | null>(null);
  useEffect(() => {
    if (!eligible || !viewerId || !visible || Platform.OS === 'web') return;
    let cancelled = false;
    let ad: NativeAd | undefined;
    let impression: { remove(): void } | undefined;
    void (async () => {
      try {
        // Fresh server verdict immediately before loading: never request for paid users.
        const current = await readAdsStatus();
        if (cancelled || !nativeEligible(true, enabled, current, 0)) return;
        const sdk = await loadAdsSdk();
        const consent = await sdk.AdsConsent.gatherConsent();
        if (cancelled || !consent.canRequestAds) return;
        await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
        await sdk.MobileAds().initialize();
        if (cancelled || !(await reserve(viewerId))) return;
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
        let reported = false;
        impression = ad.addAdEventListener(native.NativeAdEventType.IMPRESSION, () => {
          if (!reported) {
            reported = true;
            logAdEvent(viewerId, 'native_list', 'shown');
          }
        });
        if (cancelled) ad.destroy();
        else setLoaded({ sdk: native, ad });
      } catch (error) {
        noteAdFailure(error);
        logAdEvent(viewerId, 'native_list', 'failed');
        /* No fill, unavailable native module or storage failure: omit the card. */
      }
    })();
    return () => {
      cancelled = true;
      impression?.remove();
      ad?.destroy();
      setLoaded(null);
    };
  }, [eligible, enabled, viewerId, visible]);
  if (!eligible || !loaded) return null;
  const { sdk, ad } = loaded;
  return (
    <StandardCard style={{ marginVertical: theme.spacing.lg }}>
      <Text variant="caption" tone="muted">
        {t.rewardedAds.adLabel}
      </Text>
      <sdk.NativeAdView nativeAd={ad}>
        <sdk.NativeAsset assetType={sdk.NativeAssetType.HEADLINE}>
          <NativeText style={{ color: theme.color.text, fontWeight: '600' }}>
            {ad.headline}
          </NativeText>
        </sdk.NativeAsset>
        <sdk.NativeMediaView style={{ width: '100%', height: 150 }} />
        <sdk.NativeAsset assetType={sdk.NativeAssetType.BODY}>
          <NativeText style={{ color: theme.color.text }}>{ad.body}</NativeText>
        </sdk.NativeAsset>
        {ad.callToAction ? (
          <sdk.NativeAsset assetType={sdk.NativeAssetType.CALL_TO_ACTION}>
            <NativeText style={{ color: theme.color.brand }}>{ad.callToAction}</NativeText>
          </sdk.NativeAsset>
        ) : null}
      </sdk.NativeAdView>
    </StandardCard>
  );
}
