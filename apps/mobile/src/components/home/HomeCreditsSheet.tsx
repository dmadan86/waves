import { ActivityIndicator, View } from 'react-native';
import { VOICE_AGENT_PRO_MONTHLY } from '@waves/core';
import { Button, Callout, ListRow, Sheet, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import type { AdSheetState } from '@/components/RewardedAdSheet';
import { creditButtonKey, type CreditsStatus } from '@/lib/adCreditsPure';

export function HomeCreditsSheet({
  visible,
  status,
  state,
  onWatch,
  onUpgrade,
  onClose,
  onClosed,
}: {
  visible: boolean;
  status: CreditsStatus | null;
  state: AdSheetState;
  onWatch: () => void;
  onUpgrade: () => void;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const { t } = useStrings();
  const theme = useTheme();
  const busy = state.step === 'busy';
  const reward = status
    ? fill(t.homeDash.creditReward, { n: status.perAd })
    : t.credits.unavailable;
  const pro = fill(t.homeDash.creditPro, { n: VOICE_AGENT_PRO_MONTHLY });
  const blocked = !status?.canWatch;
  return (
    <Sheet
      visible={visible}
      title={t.credits.title}
      onClose={busy ? () => undefined : onClose}
      onClosed={onClosed}
      closeLabel={t.common.close}
    >
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="body">{fill(t.credits.balance, { n: status?.credits ?? 0 })}</Text>
        <ListRow
          title={t.rewardedAds.watch}
          trailing={
            <Text variant="caption" tone="muted">
              {reward}
            </Text>
          }
          accessibilityLabel={`${t.rewardedAds.watch}. ${reward}`}
          accessibilityState={{ disabled: busy || blocked }}
          onPress={busy || blocked ? undefined : onWatch}
        />
        {blocked ? (
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {status ? t.credits[creditButtonKey(status)] : t.credits.unavailable}
          </Text>
        ) : null}
        <ListRow
          title={t.rewardedAds.goPro}
          trailing={
            <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
              {pro}
            </Text>
          }
          accessibilityLabel={`${t.rewardedAds.goPro}. ${pro}`}
          accessibilityState={{ disabled: busy }}
          onPress={busy ? undefined : onUpgrade}
        />
        {busy ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', gap: theme.spacing.sm }}
          >
            <ActivityIndicator color={theme.color.brand} />
            <Text variant="caption">
              {state.confirming ? t.rewardedAds.confirming : t.rewardedAds.preparing}
            </Text>
          </View>
        ) : null}
        {state.step === 'result' ? <Callout tone={state.tone}>{state.message}</Callout> : null}
        <Button label={t.rewardedAds.notNow} variant="ghost" disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}
