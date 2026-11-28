/** A quiet nudge: one plain sentence and one text action. Replaces banners and alerts. */

import { Pressable, View } from 'react-native';

import { Row, Text, useTheme } from '@waves/ui';

export function NudgeRow({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body?: string;
  action: string;
  onAction: () => void;
}) {
  const theme = useTheme();
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.md,
        backgroundColor: theme.color.surface,
        borderRadius: 12,
        padding: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="body" style={{ fontWeight: '600' }}>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" tone="muted">
            {body}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action}, ${title}`}
        onPress={onAction}
        hitSlop={10}
        style={({ pressed }) => ({
          opacity: pressed ? 0.5 : 1,
          minHeight: 36,
          justifyContent: 'center',
        })}
      >
        <Text variant="body" tone="brand" style={{ fontWeight: '600' }}>
          {action}
        </Text>
      </Pressable>
    </Row>
  );
}
