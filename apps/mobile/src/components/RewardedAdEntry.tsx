import { Pressable } from 'react-native';
import { Text } from '@waves/ui';
import { fill, useStrings } from '@/i18n';
import { useRewardedAdOffer } from '@/lib/useRewardedAdOffer';
import type { AdKind } from '@/lib/rewardedAdsPure';

export function RewardedAdEntry({ kind }: { kind: AdKind }) {
  const offer = useRewardedAdOffer();
  const { t } = useStrings();
  return (
    <>
      {offer.canOffer(kind) ? (
        <Pressable accessibilityRole="button" onPress={() => void offer.offer(kind)}>
          <Text variant="caption" tone="brand">
            {offer.creditsKnown
              ? fill(kind === 'voice' ? t.rewardedAds.voiceTitle : t.rewardedAds.scanTitle, {
                  count: offer.amount(kind),
                })
              : kind === 'voice'
                ? t.rewardedAds.entryVoice
                : t.rewardedAds.entryScan}
          </Text>
        </Pressable>
      ) : null}
      {offer.sheet}
    </>
  );
}
