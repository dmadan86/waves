/**
 * The default wiring for `runRewardedAd`: the real SDK, loaded only when asked
 * for (so nobody who is never offered an ad loads any ad code at start-up), the
 * phone's network state, and a read of the server's own ads status.
 */

import * as Network from 'expo-network';
import { Platform } from 'react-native';

import { backend } from '@/lib/backend';
import { isOnline } from '@/lib/voiceEnginePure';
import type { AdsSdk, RewardedAdDeps } from '@/lib/rewardedAd';
import { parseAdsStatus, rewardedUnitId, type AdsStatus } from '@/lib/rewardedAdsPure';

/** The SDK, imported on first use. Throws when this build does not include it. */
export async function loadAdsSdk(): Promise<AdsSdk> {
  const sdk = (await import('react-native-google-mobile-ads')) as unknown as {
    default: () => ReturnType<AdsSdk['MobileAds']>;
    AdsConsent: AdsSdk['AdsConsent'];
    RewardedAd: AdsSdk['RewardedAd'];
    AdEventType: AdsSdk['AdEventType'];
    RewardedAdEventType: AdsSdk['RewardedAdEventType'];
  };
  return {
    MobileAds: sdk.default,
    AdsConsent: sdk.AdsConsent,
    RewardedAd: sdk.RewardedAd,
    AdEventType: sdk.AdEventType,
    RewardedAdEventType: sdk.RewardedAdEventType,
  };
}

/** `waves_my_ads_status` — what the server says about this person's ads today. */
export async function readAdsStatus(): Promise<AdsStatus | null> {
  const { data, error } = await backend.rpc('waves_my_ads_status');
  if (error) return null;
  return parseAdsStatus(data);
}

export function defaultRewardedAdDeps(): Omit<RewardedAdDeps, 'onPhase'> {
  return {
    loadSdk: loadAdsSdk,
    isOnline: async () => {
      try {
        return isOnline(await Network.getNetworkStateAsync());
      } catch {
        return true;
      }
    },
    unitId: () =>
      rewardedUnitId(
        Platform.OS,
        {
          android: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID,
          ios: process.env.EXPO_PUBLIC_ADMOB_REWARDED_IOS,
        },
        __DEV__,
      ),
    readStatus: readAdsStatus,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/**
 * Google's "privacy options" form (UMP), where a person in the EEA, UK or
 * Switzerland can change their ad consent. Loads the SDK only when asked.
 * 'none': the form is not required where they are, or the SDK is not in this build.
 */
export async function openAdPrivacyOptions(): Promise<'shown' | 'none'> {
  try {
    const sdk = await loadAdsSdk();
    const info = await sdk.AdsConsent.requestInfoUpdate();
    if (info.privacyOptionsRequirementStatus !== 'REQUIRED') return 'none';
    await sdk.AdsConsent.showPrivacyOptionsForm();
    return 'shown';
  } catch {
    return 'none';
  }
}
