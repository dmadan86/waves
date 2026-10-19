/**
 * The first-run intro card: one inline explanation, once per account, shown the
 * first time the assistant is about to ask a follow-up question.
 *
 * "I'll ask one or two quick things so the expense is complete. Skip anything;
 * 'Don't ask this again' mutes it for good." with a "Got it" that remembers.
 * It sits above the question and never blocks it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

import { AssistantEnter } from '@/components/AssistantEnter';
import { useStrings } from '@/i18n';
import { hapticSelect } from '@/lib/assistantHaptics';
import { CHIP_HEIGHT, CHIP_HIT_SLOP } from '@/lib/assistantMotion';
import { useAssistantIntro } from '@/lib/assistantIntro';

export function AssistantIntro({ viewerId }: { viewerId: string | null | undefined }) {
  const theme = useTheme();
  const { t } = useStrings();
  const intro = useAssistantIntro(viewerId);
  if (!intro.ready || intro.seen) return null;

  return (
    <AssistantEnter>
      <View
        accessibilityRole="summary"
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.spacing.md,
          padding: theme.spacing.md,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name="sparkles-outline" size={iconSize.md} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, gap: theme.spacing.sm }}>
          <Text variant="caption">{t.assistant.introBody}</Text>
          <Pressable
            onPress={() => {
              hapticSelect();
              intro.dismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel={t.assistant.introAction}
            hitSlop={CHIP_HIT_SLOP}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              minHeight: CHIP_HEIGHT,
              justifyContent: 'center',
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.brandSoft,
              borderWidth: 1,
              borderColor: theme.color.brand,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text variant="caption" style={{ fontWeight: '600' }}>
              {t.assistant.introAction}
            </Text>
          </Pressable>
        </View>
      </View>
    </AssistantEnter>
  );
}
