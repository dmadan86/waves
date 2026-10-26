import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Text, useTheme } from '@waves/ui';
import { useStrings } from '@/i18n';
import { logAdEvent, noteAdFailure } from '@/lib/adEvents';
import { loadAdsSdk, readAdsStatus } from '@/lib/adsSdk';
import { useViewerId } from '@/lib/auth';
import { readGateStatus } from '@/lib/adGates';
import { bannerGateOpen, bannerUnitId } from '@/lib/bannerAdsPure';
import { useFlagEnabled } from '@/lib/flags';
import { nativeEligible } from '@/lib/nativeAdsPure';
import { gatherConsentSafe } from '@/lib/rewardedAd';
import { ADS_REQUEST_CONFIGURATION } from '@/lib/rewardedAdsPure';
import { useEntitlement } from '@/lib/useEntitlement';

type BannerSdk = {
  BannerAd: React.ComponentType<{
    unitId: string;
    size: string;
    requestOptions: { requestNonPersonalizedAdsOnly: boolean };
    onAdLoaded: () => void;
    onAdFailedToLoad: (error: unknown) => void;
  }>;
  BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: string };
};

export function ReviewBanner({
  placement = 'review_banner',
}: { placement?: 'review_banner' | 'home_banner' } = {}) {
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
  const gate = useQuery({
    queryKey: ['bannerGate', viewerId],
    queryFn: () => readGateStatus(viewerId!),
    enabled: !!viewerId && enabled,
    staleTime: 5 * 60_000,
  });
  const eligible =
    nativeEligible(!!viewerId && !isPaid, enabled, status.data, 0) && bannerGateOpen(gate.data);
  const [banner, setBanner] = useState<{
    sdk: BannerSdk;
    isActive: () => boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  // One 'shown' per screen visit, however often the banner reloads.
  const shownLogged = useRef(false);
  useEffect(() => {
    if (!eligible || !viewerId || Platform.OS === 'web') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const [current, currentGate] = await Promise.all([
          readAdsStatus(),
          readGateStatus(viewerId).catch(() => null),
        ]);
        // A failed fresh read must be retryable even when `eligible` doesn't change.
        if (!cancelled && (!current || !currentGate))
          timer = setTimeout(() => setRetry((n) => n + 1), 15_000);
        if (cancelled || !nativeEligible(true, enabled, current, 0) || !bannerGateOpen(currentGate))
          return;
        const sdk = await loadAdsSdk();
        const consent = await gatherConsentSafe(sdk);
        if (cancelled || !consent.canRequestAds) return;
        await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
        await sdk.MobileAds().initialize();
        if (cancelled) return;
        const native = (await import('react-native-google-mobile-ads')) as unknown as BannerSdk;
        if (!cancelled) setBanner({ sdk: native, isActive: () => !cancelled });
      } catch (error) {
        noteAdFailure(error);
        logAdEvent(viewerId, placement, 'failed');
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setBanner(null);
      setLoaded(false);
    };
  }, [eligible, enabled, viewerId, retry, placement]);
  if (Platform.OS === 'web' || !eligible || !banner) return null;
  const { sdk } = banner;
  const isHome = placement === 'home_banner';
  return (
    <View
      // Mount the native request without reserving space until it has filled.
      style={
        loaded
          ? {
              marginVertical: isHome ? theme.spacing.sm : theme.spacing.lg,
              ...(isHome && {
                backgroundColor: theme.color.surface,
                borderRadius: theme.radius.lg,
                overflow: 'hidden' as const,
              }),
            }
          : { height: 0, overflow: 'hidden', opacity: 0 }
      }
      accessibilityElementsHidden={!loaded}
      importantForAccessibility={loaded ? 'auto' : 'no-hide-descendants'}
    >
      {loaded ? (
        <Text variant="caption" tone="muted">
          {t.rewardedAds.adLabel}
        </Text>
      ) : null}
      <View style={isHome ? { borderRadius: theme.radius.lg, overflow: 'hidden' } : undefined}>
        <sdk.BannerAd
          unitId={bannerUnitId(
            Platform.OS,
            Platform.OS === 'ios'
              ? process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS
              : process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID,
            __DEV__,
          )}
          size={sdk.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdLoaded={() => {
            if (!banner.isActive()) return;
            setLoaded(true);
            if (viewerId && !shownLogged.current) {
              shownLogged.current = true;
              logAdEvent(viewerId, placement, 'shown');
            }
          }}
          onAdFailedToLoad={(error) => {
            noteAdFailure(error);
            if (viewerId) logAdEvent(viewerId, placement, 'failed');
            if (banner.isActive()) {
              setLoaded(false);
              setBanner(null);
            }
          }}
        />
      </View>
    </View>
  );
}
