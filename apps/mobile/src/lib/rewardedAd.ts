/**
 * Showing one rewarded ad, start to finish, with every outside thing injected:
 * the SDK (loaded lazily, so someone who is never offered an ad never loads ad
 * code), the network check, the server read and the clock. The default wiring is
 * in `lib/adsSdk.ts`; tests drive this with fakes.
 *
 * The order, each step ending the attempt with a friendly outcome on failure:
 *   1. offline?                           -> 'offline'
 *   2. load the SDK                       -> 'unavailable'
 *   3. consent (UMP: EEA, UK, CH)         -> 'consent'
 *   4. non-personalized request + SSV ids -> load -> 'no-fill' / 'offline' / 'error'
 *   5. show; the reward event is noted    -> closed without it: 'closed-early'
 *   6. ask the server whether it credited -> 'credited', or 'pending' if not yet
 *
 * Nothing here ever grants a reward: step 6 only reads.
 */

import {
  ADS_REQUEST_CONFIGURATION,
  AD_LOAD_TIMEOUT_MS,
  adRequestOptions,
  outcomeForAdError,
  waitForCredit,
  type AdKind,
  type AdOutcome,
  type AdsStatus,
} from '@/lib/rewardedAdsPure';

/** The slice of `react-native-google-mobile-ads` this flow uses. */
export interface RewardedAdLike {
  addAdEventListener(type: string, listener: (payload?: unknown) => void): () => void;
  load(): void;
  show(): Promise<void>;
}

export interface AdsSdk {
  MobileAds(): {
    setRequestConfiguration(config: Record<string, unknown>): Promise<unknown>;
    initialize(): Promise<unknown>;
  };
  AdsConsent: {
    gatherConsent(): Promise<{ canRequestAds: boolean }>;
    requestInfoUpdate(): Promise<{ privacyOptionsRequirementStatus?: string }>;
    showPrivacyOptionsForm(): Promise<unknown>;
  };
  RewardedAd: {
    createForAdRequest(unitId: string, options: Record<string, unknown>): RewardedAdLike;
  };
  AdEventType: { LOADED: string; CLOSED: string; ERROR: string };
  RewardedAdEventType: { LOADED: string; EARNED_REWARD: string };
}

export interface RewardedAdDeps {
  loadSdk(): Promise<AdsSdk>;
  isOnline(): Promise<boolean>;
  unitId(): string;
  /** `waves_my_ads_status`, or null when it cannot be read. */
  readStatus(): Promise<AdsStatus | null>;
  sleep(ms: number): Promise<void>;
  onPhase?(phase: AdPhase): void;
}

/** Where the attempt is, for the sheet's spinner text. */
export type AdPhase = 'preparing' | 'loading' | 'showing' | 'confirming';

export async function runRewardedAd(
  input: { profileId: string; kind: AdKind; baselineUsedToday: number },
  deps: RewardedAdDeps,
): Promise<AdOutcome> {
  const phase = (p: AdPhase): void => deps.onPhase?.(p);
  phase('preparing');
  if (!(await deps.isOnline())) return 'offline';

  let sdk: AdsSdk;
  try {
    sdk = await deps.loadSdk();
  } catch {
    return 'unavailable';
  }

  try {
    // The consent form shows itself only where the law asks for one.
    const consent = await sdk.AdsConsent.gatherConsent();
    if (!consent.canRequestAds) return 'consent';
    await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
    await sdk.MobileAds().initialize();
  } catch (error) {
    const outcome = outcomeForAdError(error);
    return outcome === 'no-fill' ? 'error' : outcome;
  }

  phase('loading');
  const ad = sdk.RewardedAd.createForAdRequest(
    deps.unitId(),
    adRequestOptions(input.profileId, input.kind),
  );

  const shown = await new Promise<AdOutcome | 'watched' | 'closed'>((resolve) => {
    let earned = false;
    let settled = false;
    const cleanups: (() => void)[] = [];
    const finish = (value: AdOutcome | 'watched' | 'closed'): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const off of cleanups) off();
      resolve(value);
    };
    const timer = setTimeout(() => finish('no-fill'), AD_LOAD_TIMEOUT_MS);
    cleanups.push(
      ad.addAdEventListener(sdk.RewardedAdEventType.LOADED, () => {
        clearTimeout(timer);
        phase('showing');
        ad.show().catch((error: unknown) => finish(outcomeForAdError(error)));
      }),
      ad.addAdEventListener(sdk.RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(sdk.AdEventType.CLOSED, () => finish(earned ? 'watched' : 'closed')),
      ad.addAdEventListener(sdk.AdEventType.ERROR, (error) => finish(outcomeForAdError(error))),
    );
    try {
      ad.load();
    } catch (error) {
      finish(outcomeForAdError(error));
    }
  });

  if (shown === 'closed') return 'closed-early';
  if (shown !== 'watched') return shown;

  phase('confirming');
  const credited = await waitForCredit(input.baselineUsedToday, deps.readStatus, deps.sleep);
  return credited ? 'credited' : 'pending';
}
