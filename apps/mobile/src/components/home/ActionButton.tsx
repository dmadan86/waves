/**
 * The compact action button the tab roots share: 44dp, 10pt corners, an icon
 * and a one-line label. `primary` is the brand-filled one (one per row);
 * the rest are outlined. `iconOnly` makes a square for a secondary action.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

export function ActionButton(opts: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  onLongPress?: () => void;
  primary?: boolean;
  badge?: number;
  iconOnly?: boolean;
}) {
  const theme = useTheme();
  const brand = theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={opts.badge ? `${opts.label} (${opts.badge})` : opts.label}
      onPress={opts.onPress}
      onLongPress={opts.onLongPress}
      style={({ pressed }) => ({
        minHeight: 44,
        ...(opts.iconOnly ? { width: 44 } : null),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: opts.iconOnly ? 0 : theme.spacing.sm,
        borderRadius: theme.radius.md,
        backgroundColor: opts.primary ? brand : theme.color.surface,
        borderWidth: opts.primary ? 0 : 1,
        borderColor: theme.color.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={opts.icon} size={18} color={opts.primary ? theme.color.onBrand : brand} />
      {opts.iconOnly ? null : (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={{
            flexShrink: 1,
            fontWeight: '600',
            fontSize: 14,
            color: opts.primary ? theme.color.onBrand : theme.color.text,
          }}
        >
          {opts.label}
        </Text>
      )}
      {opts.badge ? (
        <View
          style={{
            ...(opts.iconOnly ? { position: 'absolute', top: -6, end: -6 } : null),
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 6,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.negative,
          }}
        >
          <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
            {opts.badge > 99 ? '99+' : String(opts.badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
