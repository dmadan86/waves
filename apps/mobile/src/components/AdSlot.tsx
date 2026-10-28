import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Text as NativeText, View } from 'react-native';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { router } from '@/lib/navigation';
import { Text, useTheme } from '@waves/ui';
import { useStrings } from '@/i18n';
import { adBudget } from '@/lib/adBudget';
import { lastFailureText, logAdEvent, noteAdFailure, type AdPlacement } from '@/lib/adEvents';
import { adDetail } from '@/lib/adPlanPure';
import { loadAdsSdk } from '@/lib/adsSdk';
import { bannerUnitId } from '@/lib/bannerAdsPure';
import { nativeUnitId } from '@/lib/nativeAdsPure';
import { gatherConsentSafe } from '@/lib/rewardedAd';
import { ADS_REQUEST_CONFIGURATION } from '@/lib/rewardedAdsPure';
import type { AdPlanHandle } from '@/lib/useAdPlan';

type Paid = { valueMicros?: string | null; value: number; currency: string; precision: number };
type NativeAd = {
  headline: string;
  body: string;
  callToAction?: string;
  icon?: { url: string } | null;
  images?: { url: string }[];
  mediaContent?: { hasVideoContent: boolean } | null;
  addAdEventListener(event: string, callback: (arg?: Paid) => void): { remove(): void };
  destroy(): void;
};
type NativeSdk = {
  NativeAdEventType: { IMPRESSION: string; CLICKED: string; PAID: string };
  NativeAd: { createForAdRequest(id: string, options: object): Promise<NativeAd> };
  NativeAdView: React.ComponentType<ViewProps & { nativeAd: NativeAd }>;
  NativeAsset: React.ComponentType<React.PropsWithChildren<{ assetType: string }>>;
  NativeAssetType: { ICON: string; HEADLINE: string; BODY: string; CALL_TO_ACTION: string };
};
type BannerSdk = {
  BannerAd: React.ComponentType<{
    unitId: string;
    size: string;
    width?: number;
    maxHeight?: number;
    requestOptions: { requestNonPersonalizedAdsOnly: boolean };
    onAdLoaded: () => void;
    onAdFailedToLoad: (error: unknown) => void;
    onAdImpression: () => void;
    onAdClicked: () => void;
    onPaid: (paid: Paid) => void;
  }>;
  BannerAdSize: { INLINE_ADAPTIVE_BANNER: string };
};

function placementFor(surface: string, format: 'native' | 'inline_banner'): AdPlacement {
  if (format === 'native') return 'native_list';
  return surface === 'voice_idle'
    ? 'voice_banner'
    : surface === 'settings'
      ? 'settings_banner'
      : 'activity_banner';
}
const paidDetail = (base: string, paid?: Paid) =>
  adDetail({
    micros: paid?.valueMicros ?? (paid ? Math.round(paid.value * 1e6) : ''),
    cur: paid?.currency,
    prec: paid?.precision,
  }) + (base ? `;${base}` : '');

// An unshown native is kept per surface (AdMob expires them after an hour) and reused by the next slot.
const cache = new Map<string, { ad: NativeAd; at: number }>();
const CACHE_MS = 55 * 60_000;
// When each native was first loaded, so a re-cached ad keeps its true age.
const loadedAt = new WeakMap<NativeAd, number>();
function takeCached(surface: string): NativeAd | undefined {
  const hit = cache.get(surface);
  cache.delete(surface);
  if (!hit) return undefined;
  if (Date.now() - hit.at < CACHE_MS) return hit.ad;
  hit.ad.destroy();
  return undefined;
}
function putCached(surface: string, ad: NativeAd) {
  cache.get(surface)?.ad.destroy();
  const at = loadedAt.get(ad) ?? Date.now();
  cache.set(surface, { ad, at });
  // Drop it when AdMob would expire it, even if the person never returns.
  setTimeout(
    () => {
      if (cache.get(surface)?.ad !== ad) return;
      cache.delete(surface);
      ad.destroy();
    },
    Math.max(0, CACHE_MS - (Date.now() - at)),
  );
}
// One native request in flight per surface.
const inflight = new Map<string, Promise<void>>();

function useSlotReady(handle: AdPlanHandle, active: boolean) {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [dwelt, setDwelt] = useState(false);
  const delay = handle.plan.requestDelayMs;
  useEffect(() => {
    if (!active || !focused) return;
    const wait = Math.max(0, handle.focusedAt.current + delay - Date.now());
    const id = setTimeout(() => setDwelt(true), wait);
    return () => {
      clearTimeout(id);
      setDwelt(false);
    };
  }, [active, focused, delay, handle.focusedAt]);
  return focused && dwelt;
}

function AdFrame({
  handle,
  style,
  children,
  hidden,
}: {
  handle: AdPlanHandle;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  hidden?: boolean;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  if (hidden)
    return (
      <View
        style={{ height: 0, overflow: 'hidden', opacity: 0 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </View>
    );
  return (
    <View style={style}>
      {children}
      <View style={{ alignItems: 'flex-end', paddingTop: theme.spacing.xs }}>
        <Text
          variant="caption"
          tone="muted"
          accessibilityRole="link"
          onPress={() => {
            if (handle.profileId) adBudget.noteRemoveAds(handle.profileId);
            router.push('/settings/upgrade');
          }}
        >
          {t.rewardedAds.removeAds}
        </Text>
      </View>
    </View>
  );
}

export function AdSlot({
  handle,
  format,
  slot,
  visible = true,
  rowGap = 0,
  precedingGap = 0,
  style,
}: {
  handle: AdPlanHandle;
  format: 'native' | 'inline_banner';
  /** The row number the ad follows (1-based); 0 for single banners. */
  slot: number;
  visible?: boolean;
  rowGap?: number;
  precedingGap?: number;
  /** Margins for a filled inline banner (e.g. clearance from the mic). */
  style?: StyleProp<ViewStyle>;
}) {
  return format === 'native' ? (
    <NativeSlot
      handle={handle}
      slot={slot}
      visible={visible}
      rowGap={rowGap}
      precedingGap={precedingGap}
    />
  ) : (
    <BannerSlot handle={handle} slot={slot} visible={visible} style={style} />
  );
}

function NativeSlot({
  handle,
  slot,
  visible,
  rowGap,
  precedingGap,
}: {
  handle: AdPlanHandle;
  slot: number;
  visible: boolean;
  rowGap: number;
  precedingGap: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { surface, profileId } = handle;
  // Also closed whenever the plan is empty (paid, busy, quiet window), so a mounted slot cleans up.
  const go = useSlotReady(
    handle,
    visible && profileId !== null && handle.plan.slots.length > 0 && Platform.OS !== 'web',
  );
  const [loaded, setLoaded] = useState<{ sdk: NativeSdk; ad: NativeAd } | null>(null);
  useEffect(() => {
    if (!go || !profileId) return;
    let cancelled = false;
    let ad: NativeAd | undefined;
    let reservation: ReturnType<typeof adBudget.reserve> | undefined;
    let impressed = false;
    const subs: { remove(): void }[] = [];
    let done!: () => void;
    const mine = new Promise<void>((resolve) => (done = resolve));
    const prev = inflight.get(surface) ?? Promise.resolve();
    inflight.set(
      surface,
      prev.then(() => mine),
    );
    void (async () => {
      try {
        await prev;
        if (cancelled || !handle.canRequest()) return;
        const sdk = await loadAdsSdk();
        const consent = await gatherConsentSafe(sdk);
        if (cancelled || !consent.canRequestAds) return;
        await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
        await sdk.MobileAds().initialize();
        // Re-checked after the awaits, and reserved in the same tick, so slots cannot overrun a cap.
        if (cancelled || !handle.canRequest()) return;
        // The optional native-only daily cap counts requests still in flight.
        if (
          handle.nativeCap != null &&
          adBudget.todayCount(profileId) + adBudget.pendingCount() >= handle.nativeCap
        )
          return;
        reservation = adBudget.reserve(profileId);
        const native = (await import('react-native-google-mobile-ads')) as unknown as NativeSdk;
        ad =
          takeCached(surface) ??
          (await native.NativeAd.createForAdRequest(
            nativeUnitId(
              Platform.OS,
              Platform.OS === 'ios'
                ? process.env.EXPO_PUBLIC_ADMOB_NATIVE_IOS
                : process.env.EXPO_PUBLIC_ADMOB_NATIVE_ANDROID,
              __DEV__,
            ),
            { requestNonPersonalizedAdsOnly: true },
          ));
        // AdMob requires a MediaView for video ads; this compact row cannot show them.
        if (cancelled || ad.mediaContent?.hasVideoContent) {
          ad.destroy();
          ad = undefined;
          reservation.release();
          return;
        }
        if (!loadedAt.has(ad)) loadedAt.set(ad, Date.now());
        const detail = handle.detail(slot);
        const placement = placementFor(surface, 'native');
        subs.push(
          ad.addAdEventListener(native.NativeAdEventType.IMPRESSION, () => {
            if (impressed) return;
            impressed = true;
            reservation?.confirm();
            handle.markShown();
            logAdEvent(profileId, placement, 'shown', detail);
          }),
          ad.addAdEventListener(native.NativeAdEventType.CLICKED, () =>
            logAdEvent(profileId, placement, 'clicked', detail),
          ),
          ad.addAdEventListener(native.NativeAdEventType.PAID, (paid) =>
            logAdEvent(profileId, placement, 'paid', paidDetail(`s=${surface};i=${slot}`, paid)),
          ),
        );
        setLoaded({ sdk: native, ad });
      } catch (error) {
        reservation?.release();
        adBudget.noteFailure(surface);
        noteAdFailure(error);
        logAdEvent(
          profileId,
          placementFor(surface, 'native'),
          'failed',
          adDetail({ s: surface, code: lastFailureText() }),
        );
        /* No fill, unavailable native module or storage failure: omit the card. */
      } finally {
        done();
      }
    })();
    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
      if (!impressed) reservation?.release();
      if (ad) {
        if (impressed) ad.destroy();
        else putCached(surface, ad);
      }
      setLoaded(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handle fields are read at request time on purpose
  }, [go, profileId, surface, slot]);
  if (!go || !loaded) return null;
  const { sdk, ad } = loaded;
  const icon = ad.icon ?? ad.images?.[0];
  return (
    <View style={{ paddingTop: Math.max(0, rowGap - precedingGap), paddingBottom: rowGap }}>
      <AdFrame handle={handle}>
        <View
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
          <sdk.NativeAdView nativeAd={ad} style={{ width: '100%' }}>
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
                  <NativeText
                    numberOfLines={1}
                    style={{ color: theme.color.textMuted, fontSize: 12 }}
                  >
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
      </AdFrame>
    </View>
  );
}

function BannerSlot({
  handle,
  slot,
  visible,
  style,
}: {
  handle: AdPlanHandle;
  slot: number;
  visible: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { surface, profileId } = handle;
  // Also closed whenever the plan is empty (paid, busy, quiet window), so a mounted slot cleans up.
  const go = useSlotReady(
    handle,
    visible &&
      profileId !== null &&
      (handle.plan.inlineBanner || handle.plan.footerBanner) &&
      Platform.OS !== 'web',
  );
  const [sdk, setSdk] = useState<BannerSdk | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [width, setWidth] = useState(0);
  const firstShown = useRef(false);
  const [reservation, setReservation] = useState<ReturnType<typeof adBudget.reserve> | null>(null);
  useEffect(() => {
    if (!go || !profileId) return;
    let cancelled = false;
    let held: ReturnType<typeof adBudget.reserve> | undefined;
    void (async () => {
      try {
        if (!handle.canRequest()) return;
        const sdkBase = await loadAdsSdk();
        const consent = await gatherConsentSafe(sdkBase);
        if (cancelled || !consent.canRequestAds) return;
        await sdkBase.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
        await sdkBase.MobileAds().initialize();
        if (cancelled || !handle.canRequest()) return;
        held = adBudget.reserve(profileId);
        const mod = (await import('react-native-google-mobile-ads')) as unknown as BannerSdk;
        if (cancelled) return;
        setReservation(held);
        setSdk(mod);
      } catch (error) {
        held?.release();
        adBudget.noteFailure(surface);
        noteAdFailure(error);
        logAdEvent(
          profileId,
          placementFor(surface, 'inline_banner'),
          'failed',
          adDetail({ s: surface, code: lastFailureText() }),
        );
      }
    })();
    return () => {
      cancelled = true;
      held?.release();
      firstShown.current = false;
      setReservation(null);
      setSdk(null);
      setLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handle fields are read at request time on purpose
  }, [go, profileId, surface]);
  if (!go || !profileId) return null;
  const placement = placementFor(surface, 'inline_banner');
  const detail = handle.detail(slot);
  const filled = loaded && sdk != null;
  return (
    <View
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={filled ? style : undefined}
    >
      <AdFrame handle={handle} hidden={!filled}>
        {filled ? (
          <Text variant="caption" tone="muted">
            {t.rewardedAds.adLabel}
          </Text>
        ) : null}
        {sdk && width > 0 ? (
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
              size={sdk.BannerAdSize.INLINE_ADAPTIVE_BANNER}
              width={width}
              maxHeight={120}
              requestOptions={{ requestNonPersonalizedAdsOnly: true }}
              onAdLoaded={() => setLoaded(true)}
              onAdImpression={() => {
                // AdMob may refresh a banner: each later impression takes a fresh reservation.
                if (firstShown.current) adBudget.reserve(profileId).confirm();
                else reservation?.confirm();
                firstShown.current = true;
                handle.markShown();
                logAdEvent(profileId, placement, 'shown', detail);
              }}
              onAdClicked={() => logAdEvent(profileId, placement, 'clicked', detail)}
              onPaid={(paid) =>
                logAdEvent(profileId, placement, 'paid', paidDetail(`s=${surface};i=${slot}`, paid))
              }
              onAdFailedToLoad={(error) => {
                reservation?.release();
                adBudget.noteFailure(surface);
                noteAdFailure(error);
                logAdEvent(
                  profileId,
                  placement,
                  'failed',
                  adDetail({ s: surface, code: lastFailureText() }),
                );
                setLoaded(false);
                setSdk(null);
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
        ) : null}
      </AdFrame>
    </View>
  );
}
