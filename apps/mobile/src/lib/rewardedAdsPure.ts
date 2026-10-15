/**
 * Rewarded ads (Free plan, phase 1) — the parts that need no native module, so
 * the rules can be tested apart from the SDK and the screen. See docs/ads.md.
 *
 * One rewarded video, only when the person taps "Watch", at two natural moments:
 * the AI voice monthly limit and the receipt-scan limit. The phone never grants
 * a reward: Google calls the `admob-ssv` edge function, the server credits the
 * month's allowance, and the app only asks the server whether that happened.
 */

/** What an ad is for: the kind goes to AdMob as `custom_data` and comes back in the signed callback. */
export type AdKind = 'voice' | 'scan';

/**
 * Google's official TEST rewarded ad units. Used when no real unit is configured
 * (`EXPO_PUBLIC_ADMOB_REWARDED_ANDROID` / `_IOS`) and always in development.
 * Test ads are safe to tap; they pay nothing, and the server only rewards units
 * listed in its `ADMOB_AD_UNIT_IDS` secret.
 */
export const TEST_REWARDED_UNIT = {
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
} as const;

/** The unit to request on this platform: the configured one, else Google's test unit. */
export function rewardedUnitId(
  platform: 'android' | 'ios' | string,
  configured: { android?: string | undefined; ios?: string | undefined },
  dev: boolean,
): string {
  const platformKey = platform === 'ios' ? 'ios' : 'android';
  if (dev) return TEST_REWARDED_UNIT[platformKey];
  const value = configured[platformKey]?.trim();
  return value ? value : TEST_REWARDED_UNIT[platformKey];
}

/**
 * What the ad request carries so the server can attribute the reward: the
 * profile id as `userId`, the kind as `customData`. Both come back inside
 * Google's signature.
 */
export function ssvOptions(
  profileId: string,
  kind: AdKind,
): { userId: string; customData: AdKind } {
  return { userId: profileId, customData: kind };
}

/**
 * The ad request options. Non-personalized, always: no advertising-id based ads,
 * and no App Tracking Transparency prompt on iOS (the Info.plist has no
 * NSUserTrackingUsageDescription).
 */
export function adRequestOptions(profileId: string, kind: AdKind) {
  return {
    requestNonPersonalizedAdsOnly: true,
    serverSideVerificationOptions: ssvOptions(profileId, kind),
  } as const;
}

/** Applied before any request: family-safe content, nothing aimed at children. */
export const ADS_REQUEST_CONFIGURATION = {
  maxAdContentRating: 'PG',
  tagForChildDirectedTreatment: false,
  tagForUnderAgeOfConsent: false,
} as const;

/** How the attempt ended, for the sheet to say in a few friendly words. */
export type AdOutcome =
  /** Watched to the end and the server confirmed the reward. */
  | 'credited'
  /** Watched to the end; the server has not confirmed yet (SSV is slow sometimes). */
  | 'pending'
  /** Closed before the reward: nothing is added. */
  | 'closed-early'
  /** The ad network has nothing to show right now. */
  | 'no-fill'
  | 'offline'
  /** The consent choice (EEA, UK, Switzerland) does not allow ads. */
  | 'consent'
  /** The SDK is not in this build, or not configured. */
  | 'unavailable'
  | 'error';

/**
 * Maps a load/show error from the ads SDK to an outcome. The SDK's errors carry
 * a code such as `googleMobileAds/error-code-no-fill` and `…network-error`.
 */
export function outcomeForAdError(error: unknown): AdOutcome {
  const text = [
    (error as { code?: unknown } | null)?.code,
    (error as { message?: unknown } | null)?.message,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  if (/no-fill|no fill|nofill|no ad to show/.test(text)) return 'no-fill';
  if (/network|internet|offline|timed out|timeout/.test(text)) return 'offline';
  return 'error';
}

export const CREDIT_POLL_INTERVAL_MS = 1500;
export const CREDIT_POLL_ATTEMPTS = 10;
/** How long to wait for an ad to load before giving up. */
export const AD_LOAD_TIMEOUT_MS = 20_000;

export interface AdsStatus {
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly usedToday: number;
  readonly dailyCap: number;
  readonly voicePerAd: number;
  readonly scansPerAd: number;
}

/** `waves_my_ads_status`'s answer; anything unexpected reads as "not eligible". */
export function parseAdsStatus(data: unknown): AdsStatus {
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    eligible: row.eligible === true,
    reason: typeof row.reason === 'string' ? row.reason : null,
    usedToday: num(row.usedToday, 0),
    dailyCap: num(row.dailyCap, 3),
    voicePerAd: num(row.voicePerAd, 2),
    scansPerAd: num(row.scansPerAd, 2),
  };
}

/** Units one ad is worth for this kind, from the server's settings. */
export function rewardAmount(status: Pick<AdsStatus, 'voicePerAd' | 'scansPerAd'>, kind: AdKind) {
  return kind === 'voice' ? status.voicePerAd : status.scansPerAd;
}

/**
 * After the ad: has the server recorded the reward? It has when today's count
 * went up from what it was before the ad. Polls a few times, because Google's
 * callback arrives a moment after the ad closes. Never grants anything itself.
 */
export async function waitForCredit(
  baselineUsedToday: number,
  read: () => Promise<AdsStatus | null>,
  sleep: (ms: number) => Promise<void>,
  attempts = CREDIT_POLL_ATTEMPTS,
  intervalMs = CREDIT_POLL_INTERVAL_MS,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);
    const status = await read().catch(() => null);
    if (status && status.usedToday > baselineUsedToday) return true;
  }
  return false;
}

/** Whether a receipt-parse failure message is the scan-quota refusal. */
export function isScanQuotaMessage(message: unknown): boolean {
  return typeof message === 'string' && message.includes('SCAN_QUOTA_REACHED');
}
