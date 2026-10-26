import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Text, useTheme } from '@waves/ui';
import { useStrings } from '@/i18n';
import { logAdEvent, noteAdFailure } from '@/lib/adEvents';
import { loadAdsSdk } from '@/lib/adsSdk';
import { useViewerId } from '@/lib/auth';
import { adGateQuery } from '@/lib/adGateQuery';
import { shouldMountBanner, bannerUnitId } from '@/lib/bannerAdsPure';
import { useFlagEnabled } from '@/lib/flags';
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
  const gate = useQuery({
    ...adGateQuery(viewerId),
    enabled: !!viewerId && enabled && !isPaid,
  });
  const eligible = !!viewerId && enabled && shouldMountBanner(gate.data, isPaid);
  const confirmed = eligible && !gate.isFetching && !gate.isError;
  const [banner, setBanner] = useState<{
    sdk: BannerSdk;
    isActive: () => boolean;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  // One 'shown' per screen visit, however often the banner reloads.
  const shownLogged = useRef(false);
  useEffect(() => {
    if (!eligible || !viewerId || Platform.OS === 'web') return;
    let cancelled = false;
    void (async () => {
      try {
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
      setBanner(null);
      setLoaded(false);
    };
  }, [eligible, viewerId, placement]);
  const visible = loaded && confirmed;
  useEffect(() => {
    if (!visible || !viewerId || shownLogged.current) return;
    shownLogged.current = true;
    logAdEvent(viewerId, placement, 'shown');
  }, [visible, viewerId, placement]);
  if (Platform.OS === 'web' || !eligible || !banner) return null;
  const { sdk } = banner;
  const isHome = placement === 'home_banner';
  return (
    <View
      // Mount the native request without reserving space until it has filled.
      style={
        visible
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
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {visible ? (
        <Text variant="caption" tone="muted">
          {t.rewardedAds.adLabel}
        </Text>
      ) : null}
      <View
        collapsable={false}
        style={{
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
        }}
      >
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
        {/* Mask WebView corners when Android ignores native clipping. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -theme.radius.lg,
            right: -theme.radius.lg,
            bottom: -theme.radius.lg,
            left: -theme.radius.lg,
            borderRadius: theme.radius.lg * 2,
            borderWidth: theme.radius.lg,
            borderColor: theme.color.bg,
          }}
        />
      </View>
    </View>
  );
}
