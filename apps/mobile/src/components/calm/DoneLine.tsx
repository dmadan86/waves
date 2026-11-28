/** Done is one quiet line: a tick and a sentence, never a stack of green rows. */

import Ionicons from '@expo/vector-icons/Ionicons';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

export function DoneLine({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      <Ionicons name="checkmark-circle" size={iconSize.md} color={theme.color.brand} />
      <Text variant="caption" tone="muted" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}
