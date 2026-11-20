import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, iconSize, useTheme } from '@waves/ui';
import { View } from 'react-native';

/** A detail row's answer as a soft brand pill with its glyph ("Cash", "Add"),
 *  the way the add-expense design draws a chosen value. */
export function RowPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name={icon} size={iconSize.sm} color={theme.color.brand} />
      <Text variant="caption" tone="brand" style={{ fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
