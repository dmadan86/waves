/**
 * The Free-user teaser row, and the sheet that explains a Pro-only correction.
 *
 * The row replaces the follow-up question a Pro person would get: one static
 * line, "Pro would ask: Where was this? · See Pro", dismissible, at most once
 * every seven days, never in the way. The sheet is the other half of the same
 * idea: a Free person who types a correction that needs the model is told so
 * and offered the plans, instead of a dead end.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Button, iconSize, Sheet, Text, useTheme } from '@waves/ui';

import { AssistantEnter } from '@/components/AssistantEnter';
import { fill, useStrings } from '@/i18n';
import { CHIP_HIT_SLOP } from '@/lib/assistantMotion';
import { trackAssistantPremiumViewed } from '@/lib/assistantTelemetry';
import { useAssistantTeaser, type TeaserKind } from '@/lib/assistantTeaser';
import { router } from '@/lib/navigation';

export function AssistantTeaser({
  viewerId,
  isPro,
  kind = 'place',
}: {
  viewerId: string | null | undefined;
  isPro: boolean;
  kind?: TeaserKind;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const teaser = useAssistantTeaser(viewerId, { enabled: !isPro, kind });
  if (!teaser.visible) return null;

  const question =
    kind === 'receipt'
      ? t.assistant.teaserReceipt
      : kind === 'payment'
        ? t.assistant.teaserPayment
        : t.assistant.teaserPlace;
  const line = fill(t.assistant.teaserLine, { question });

  return (
    <AssistantEnter>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
          paddingLeft: theme.spacing.md,
          paddingRight: theme.spacing.xs,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
        }}
      >
        <Ionicons name="sparkles-outline" size={iconSize.md} color={theme.color.brand} />
        <Text variant="caption" style={{ flex: 1 }} numberOfLines={2}>
          {line}
        </Text>
        <Pressable
          onPress={teaser.openPlans}
          accessibilityRole="link"
          accessibilityLabel={`${line} ${t.assistant.teaserCta}`}
          hitSlop={CHIP_HIT_SLOP}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing.xs,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '600' }}>
            {t.assistant.teaserCta}
          </Text>
        </Pressable>
        <Pressable
          onPress={teaser.dismiss}
          accessibilityRole="button"
          accessibilityLabel={t.assistant.teaserDismiss}
          hitSlop={CHIP_HIT_SLOP}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="close" size={iconSize.base} color={theme.color.textMuted} />
        </Pressable>
      </View>
    </AssistantEnter>
  );
}

/** "Corrections by chat are Pro": shown when a Free correction needs the model. */
export function AssistantProSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t.common.close}>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="heading">{t.assistant.proSheetTitle}</Text>
        <Text tone="muted">{t.assistant.proSheetBody}</Text>
        <Button
          label={t.assistant.proSheetCta}
          onPress={() => {
            onClose();
            trackAssistantPremiumViewed();
            router.push('/paywall');
          }}
        />
        <Button label={t.assistant.proSheetLater} variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}
