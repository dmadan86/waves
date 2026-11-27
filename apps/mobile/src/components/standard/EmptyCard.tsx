/**
 * An empty card on a home or tab root: a small tinted icon, one short title, one
 * muted helper line, and a compact action only where an action makes sense.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { Button, iconSize, Text, useTheme } from '@waves/ui';

import { StandardCard } from './parts';

export function EmptyCard({
  icon,
  title,
  helper,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  helper: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <StandardCard
      style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brandSoft,
        }}
      >
        <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
      </View>
      <Text style={{ fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {helper}
      </Text>
      {action ? (
        <Button label={action.label} size="sm" variant="secondary" onPress={action.onPress} />
      ) : null}
    </StandardCard>
  );
}
