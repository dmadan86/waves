import { Platform } from 'react-native';
import { defaultRewardedAdDeps } from './adsSdk';
import { runRewardedAd } from './rewardedAd';
import { readCredits } from './adCredits';
import { logAdEvent, type AdPlacement } from './adEvents';
export async function watchCreditAd(
  profileId: string,
  source: 'offer' | 'voluntary' | 'voice' | 'gate',
  placement: AdPlacement,
) {
  const before = await readCredits();
  if (!before?.canWatch) return 'unavailable' as const;
  const deps = defaultRewardedAdDeps();
  if (source === 'offer')
    deps.unitId = () => {
      const ios = Platform.OS === 'ios';
      const configured = ios
        ? process.env.EXPO_PUBLIC_ADMOB_REWARDED_INTERSTITIAL_IOS
        : process.env.EXPO_PUBLIC_ADMOB_REWARDED_INTERSTITIAL_ANDROID;
      return (
        (!__DEV__ && configured?.trim()) ||
        (ios ? 'ca-app-pub-3940256099942544/6978759866' : 'ca-app-pub-3940256099942544/5354046379')
      );
    };
  const result = await runRewardedAd(
    {
      profileId,
      kind: `credit:${source}`,
      baselineUsedToday: 0,
      baselineCredits: before.credits,
      format: source === 'offer' ? 'rewardedInterstitial' : 'rewarded',
    },
    { ...deps, readCredits, onShown: () => logAdEvent(profileId, placement, 'shown') },
  );
  logAdEvent(
    profileId,
    placement,
    result === 'credited'
      ? 'credit_earned'
      : result === 'pending'
        ? 'completed'
        : result === 'closed-early'
          ? 'skipped'
          : 'failed',
  );
  return result;
}
