/**
 * The review's one open question: a warning-soft card with the question on top
 * and its answers as pills under it. A tap on a pill is the answer; the card
 * never holds a selection or a Continue. The screen decides which question is
 * up (see `lib/voiceReviewPure`) and shows nothing else of the review meanwhile.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

export interface ReviewOption {
  key: string;
  label: string;
}

export function ReviewQuestionCard({
  title,
  options,
  onSelect,
  action,
}: {
  title: string;
  options: readonly ReviewOption[];
  /** A pill was tapped: its key is the answer. */
  onSelect?: (key: string) => void;
  /** A way out of the pills: open the full list. */
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  const pill = (label: string, onPress: () => void, key: string, outlined: boolean) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: outlined ? theme.color.border : theme.color.warning,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontWeight: '600', color: outlined ? theme.color.brand : theme.color.text }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View
      accessibilityRole="alert"
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.warningSoft,
      }}
    >
      <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
        <Ionicons name="help-circle-outline" size={iconSize.sm} color={theme.color.text} />
        <Text style={{ fontWeight: '700', flex: 1 }}>{title}</Text>
      </Row>
      <Row gap={theme.spacing.xs} style={{ flexWrap: 'wrap' }}>
        {options.map((option) =>
          pill(option.label, () => onSelect?.(option.key), option.key, false),
        )}
        {action ? pill(action.label, action.onPress, 'action', true) : null}
      </Row>
    </View>
  );
}
