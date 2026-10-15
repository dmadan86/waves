/**
 * The small sheet offered at the two natural moments for a Free person: the AI
 * voice monthly limit and the receipt-scan limit. "Watch a short ad for 2 more
 * AI voice commands" / "Upgrade to Plus" / "Not now". Nothing starts until the
 * Watch button is tapped, and nothing is forced. Presentational only: the flow
 * lives in `useRewardedAdOffer`.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, View } from 'react-native';

import { Button, Callout, iconSize, Sheet, Text, useTheme, type CalloutTone } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import type { AdKind } from '@/lib/rewardedAdsPure';

export type AdSheetState =
  | { step: 'ready' }
  | { step: 'busy'; confirming: boolean }
  | { step: 'result'; message: string; tone: CalloutTone; done: boolean };

export function RewardedAdSheet({
  visible,
  kind,
  amount,
  state,
  onWatch,
  onUpgrade,
  onClose,
}: {
  visible: boolean;
  kind: AdKind;
  /** Units one ad gives, from the server's settings. */
  amount: number;
  state: AdSheetState;
  onWatch: () => void;
  onUpgrade: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const a = t.rewardedAds;
  const busy = state.step === 'busy';
  const done = state.step === 'result' && state.done;
  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" accessibilityRole="header">
            {fill(kind === 'voice' ? a.voiceTitle : a.scanTitle, { count: amount })}
          </Text>
          <Text variant="caption" tone="muted">
            {kind === 'voice' ? a.voiceBody : a.scanBody}
          </Text>
        </View>

        {busy ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
          >
            <ActivityIndicator color={theme.color.brand} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {state.confirming ? a.confirming : a.preparing}
            </Text>
          </View>
        ) : null}

        {state.step === 'result' ? <Callout tone={state.tone}>{state.message}</Callout> : null}

        <View style={{ gap: theme.spacing.sm }}>
          {done ? (
            <Button label={a.done} variant="brand" fullWidth onPress={onClose} />
          ) : (
            <>
              <Button
                label={state.step === 'result' ? a.tryAgain : a.watch}
                variant="brand"
                fullWidth
                disabled={busy}
                onPress={onWatch}
                icon={
                  <Ionicons name="play-circle" size={iconSize.md} color={theme.color.onBrand} />
                }
              />
              <Button
                label={a.upgrade}
                variant="secondary"
                fullWidth
                disabled={busy}
                onPress={onUpgrade}
              />
              <Button
                label={a.notNow}
                variant="ghost"
                fullWidth
                disabled={busy}
                onPress={onClose}
              />
            </>
          )}
        </View>
        <Text variant="micro" tone="faint" style={{ textAlign: 'center' }}>
          {a.footnote}
        </Text>
      </View>
    </Sheet>
  );
}
