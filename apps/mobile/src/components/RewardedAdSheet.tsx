/**
 * The small sheet offered at the two natural moments for a Free person: the AI
 * voice monthly limit and the receipt-scan limit.
 * Automatic offers use credit-focused copy. Nothing starts until the
 * Watch button is tapped, and nothing is forced. Presentational only: the flow
 * lives in `useRewardedAdOffer`.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

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
  credits,
  capReached = false,
  outOfCredits = false,
  state,
  onWatch,
  onUpgrade,
  onClose,
}: {
  visible: boolean;
  kind: AdKind;
  /** Units one ad gives, from the server's settings. */
  amount: number;
  credits?: number;
  capReached?: boolean;
  /** Automatic quota offers use credit-focused copy. */
  outOfCredits?: boolean;
  state: AdSheetState;
  onWatch: () => void;
  onUpgrade: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const a = t.rewardedAds;
  const upgradeLabel = outOfCredits ? a.goPro : a.upgrade;
  const balanceParts = a.balance.split('{n}');
  const busy = state.step === 'busy';
  const done = state.step === 'result' && state.done;
  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name={kind === 'voice' ? 'mic' : 'scan'}
              size={iconSize.xl}
              color={theme.color.brand}
            />
          </View>
          <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {outOfCredits
              ? a.outOfCredits
              : fill(kind === 'voice' ? a.voiceTitle : a.scanTitle, { count: amount })}
          </Text>
          {!outOfCredits && (
            <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {kind === 'voice' ? a.voiceBody : a.scanBody}
            </Text>
          )}
        </View>

        {credits !== undefined && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="flash" size={iconSize.md} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Text variant="body">
                {balanceParts[0]}
                <Text style={{ color: theme.color.brand }}>{credits}</Text>
                {balanceParts[1]}
              </Text>
              {kind === 'voice' && (
                <Text variant="caption" tone="muted">
                  {fill(a.perAdVoice, { count: amount })}
                </Text>
              )}
            </View>
          </View>
        )}
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
                label={
                  capReached
                    ? a.dailyLimit
                    : state.step === 'result'
                      ? a.tryAgain
                      : outOfCredits
                        ? fill(a.watchShort, { count: amount })
                        : kind === 'voice'
                          ? fill(a.watchWithCount, { count: amount })
                          : a.watch
                }
                variant="brand"
                fullWidth
                disabled={busy || capReached}
                onPress={onWatch}
                icon={
                  <Ionicons name="play-circle" size={iconSize.md} color={theme.color.onBrand} />
                }
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${upgradeLabel}. ${a.upgradeBody}`}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onUpgrade}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  padding: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.color.border,
                  opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                <MaterialCommunityIcons name="crown" size={iconSize.md} color={theme.color.brand} />
                <View style={{ flex: 1, gap: theme.spacing.xs }}>
                  <Text variant="subheading">{upgradeLabel}</Text>
                  <Text variant="caption" tone="muted">
                    {a.upgradeBody}
                  </Text>
                </View>
              </Pressable>
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
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.color.border,
            paddingTop: theme.spacing.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
          <Text variant="micro" tone="muted" style={{ flex: 1 }}>
            {a.footnote}
          </Text>
        </View>
      </View>
    </Sheet>
  );
}
