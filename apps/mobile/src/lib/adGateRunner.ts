import { noteAdFailure } from './adEvents';
import {
  gatherConsentSafe,
  type AdsSdk,
  type RewardedAdDeps,
  type RewardedAdLike,
} from './rewardedAd';
import { ADS_REQUEST_CONFIGURATION, AD_LOAD_TIMEOUT_MS } from './rewardedAdsPure';
import type { GateResult } from './adPacingPure';

export interface PreparedInterstitial {
  sdk: AdsSdk;
  ad: RewardedAdLike;
  loadedAt: number;
}
/** Load in advance; the post-save transition only uses an already ready ad. */
export async function prepareInterstitial(
  deps: Pick<RewardedAdDeps, 'loadSdk' | 'isOnline' | 'unitId'>,
): Promise<PreparedInterstitial | null> {
  try {
    if (!(await deps.isOnline())) return null;
    const sdk = await deps.loadSdk();
    if (!sdk.InterstitialAd || !(await gatherConsentSafe(sdk)).canRequestAds) return null;
    await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
    await sdk.MobileAds().initialize();
    const ad = sdk.InterstitialAd.createForAdRequest(deps.unitId(), {
      requestNonPersonalizedAdsOnly: true,
    });
    return await new Promise<PreparedInterstitial | null>((resolve) => {
      const offs: (() => void)[] = [];
      let done = false;
      const finish = (value: PreparedInterstitial | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        offs.forEach((off) => off());
        resolve(value);
      };
      const timer = setTimeout(() => {
        noteAdFailure('timeout');
        finish(null);
      }, AD_LOAD_TIMEOUT_MS);
      offs.push(
        ad.addAdEventListener(sdk.AdEventType.LOADED, () =>
          finish({ sdk, ad, loadedAt: Date.now() }),
        ),
      );
      offs.push(
        ad.addAdEventListener(sdk.AdEventType.ERROR, (error?: unknown) => {
          noteAdFailure(error);
          finish(null);
        }),
      );
      try {
        ad.load();
      } catch {
        finish(null);
      }
    });
  } catch {
    return null;
  }
}

/** Uses the existing lazy SDK and UMP wiring; gates never grant AI quota. */
export async function runGateAd(
  rewarded: boolean,
  deps: Pick<RewardedAdDeps, 'loadSdk' | 'isOnline' | 'unitId'>,
  onShown: () => void,
  prepared?: PreparedInterstitial,
  canShow: () => boolean = () => true,
): Promise<GateResult> {
  try {
    if (!(await deps.isOnline())) {
      noteAdFailure('offline');
      return 'failed';
    }
    const sdk: AdsSdk = prepared?.sdk ?? (await deps.loadSdk());
    const consent = prepared ? { canRequestAds: true } : await gatherConsentSafe(sdk);
    if (!consent.canRequestAds) {
      noteAdFailure('consent: cannot request ads');
      return 'failed';
    }
    if (!prepared) {
      await sdk.MobileAds().setRequestConfiguration({ ...ADS_REQUEST_CONFIGURATION });
      await sdk.MobileAds().initialize();
    }
    const factory = rewarded ? sdk.RewardedAd : sdk.InterstitialAd;
    if (!factory) {
      noteAdFailure('no ad factory in SDK');
      return 'failed';
    }
    const ad =
      prepared?.ad ??
      factory.createForAdRequest(deps.unitId(), { requestNonPersonalizedAdsOnly: true });
    return await new Promise<GateResult>((resolve) => {
      let earned = false;
      let shown = false;
      let settled = false;
      const cleanups: (() => void)[] = [];
      const finish = (result: GateResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanups.forEach((off) => off());
        resolve(result);
      };
      const timer = setTimeout(() => {
        noteAdFailure('timeout');
        finish('failed');
      }, AD_LOAD_TIMEOUT_MS);
      const listen = (event: string, callback: () => void) =>
        cleanups.push(ad.addAdEventListener(event, callback));
      listen(rewarded ? sdk.RewardedAdEventType.LOADED : sdk.AdEventType.LOADED, () => {
        clearTimeout(timer);
        if (!canShow()) {
          finish('failed');
          return;
        }
        try {
          void ad.show().catch(() => finish('failed'));
        } catch {
          finish('failed');
        }
      });
      listen(sdk.AdEventType.OPENED ?? 'opened', () => {
        if (!shown) {
          shown = true;
          onShown();
        }
      });
      if (rewarded)
        listen(sdk.RewardedAdEventType.EARNED_REWARD, () => {
          earned = true;
        });
      listen(sdk.AdEventType.CLOSED, () =>
        finish(rewarded ? (earned ? 'completed' : 'skipped') : 'skipped'),
      );
      cleanups.push(
        ad.addAdEventListener(sdk.AdEventType.ERROR, (error?: unknown) => {
          noteAdFailure(error);
          finish('failed');
        }),
      );
      try {
        if (prepared) {
          clearTimeout(timer);
          if (!canShow()) finish('failed');
          else void ad.show().catch(() => finish('failed'));
        } else ad.load();
      } catch {
        finish('failed');
      }
    });
  } catch (error) {
    noteAdFailure(error);
    return 'failed';
  }
}
