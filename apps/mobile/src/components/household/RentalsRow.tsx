/** The household home's Rentals row: opens the group's own rentals (never Personal's). */
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function RentalsRow({
  groupId,
  count,
  amountText,
}: {
  groupId: string;
  count: number;
  /** This month's rent received, already formatted. */
  amountText: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const w = t.wealth;
  return (
    <Card style={{ padding: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${w.rentals}. ${fill(w.rentalsRowSub, { n: count, amount: amountText })}`}
        onPress={() => router.push({ pathname: '/rentals', params: { space: groupId } })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="home-outline" size={iconSize.md} color={theme.color.brand} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700' }} numberOfLines={1}>
            {w.rentals}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {count === 0
              ? w.trackRentTitle
              : fill(w.rentalsRowSub, { n: count, amount: amountText })}
          </Text>
        </View>
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      </Pressable>
    </Card>
  );
}
