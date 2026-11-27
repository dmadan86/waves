/** The household home's Vehicles row: opens the group's own vehicles (never Personal's). */
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { usePersonalVehicles } from '@/data/vehicles';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function VehiclesRow({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const v = t.vehicles;
  const count = usePersonalVehicles(groupId).vehicles.filter((x) => x.status === 'active').length;
  const sub = count === 0 ? v.accountsCardSub : fill(v.vehiclesCount, { n: count });
  return (
    <Card style={{ padding: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${v.vehicles}. ${sub}`}
        onPress={() => router.push({ pathname: '/vehicles', params: { space: groupId } })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="car-outline" size={iconSize.md} color={theme.color.brand} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700' }} numberOfLines={1}>
            {v.vehicles}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={theme.color.textMuted} />
      </Pressable>
    </Card>
  );
}
