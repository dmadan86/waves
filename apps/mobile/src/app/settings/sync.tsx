/**
 * Which networks sync may use.
 *
 * Three choices with Wi‑Fi first, the default — the same shape as the theme and
 * motion screens, because it is the same kind of decision: a preference the app
 * remembers about how it should behave in the background. The queue is always
 * safe on disk (ADR-005); this only decides when it is allowed to leave.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { Card, iconSize, ListRow, Screen, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { PlainHeader } from '@/components/standard/PlainHeader';
import { useStrings } from '@/i18n';
import { SyncNetworkPreference, useSyncNetwork } from '@/lib/syncNetwork';

export default function SyncSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const { preference, setPreference } = useSyncNetwork();

  const rows: {
    key: string;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    value: SyncNetworkPreference;
  }[] = [
    {
      key: 'wifi',
      title: t.sync.wifi,
      subtitle: t.sync.wifiHint,
      icon: 'wifi-outline',
      value: SyncNetworkPreference.Wifi,
    },
    {
      key: 'cellular',
      title: t.sync.cellular,
      subtitle: t.sync.cellularHint,
      icon: 'cellular-outline',
      value: SyncNetworkPreference.Cellular,
    },
    {
      key: 'both',
      title: t.sync.both,
      subtitle: t.sync.bothHint,
      icon: 'globe-outline',
      value: SyncNetworkPreference.Both,
    },
  ];

  return (
    <Screen edges={[]}>
      <PlainHeader title={t.sync.title} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
          {rows.map((row, index) => {
            const chosen = preference === row.value;
            return (
              <View key={row.key}>
                <ListRow
                  title={row.title}
                  subtitle={row.subtitle}
                  onPress={() => void setPreference(row.value)}
                  // A picker row, not a door: choosing is idempotent and every
                  // tap should land.
                  repeatable
                  accessibilityLabel={`${row.title}${chosen ? `, ${t.sync.selected}` : ''}`}
                  leading={<Ionicons name={row.icon} size={iconSize.xl} color={theme.color.text} />}
                  trailing={
                    chosen ? (
                      <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.brand} />
                    ) : null
                  }
                />
                {index < rows.length - 1 ? (
                  <View style={{ height: 1, backgroundColor: theme.color.border }} />
                ) : null}
              </View>
            );
          })}
        </Card>

        <Text variant="micro" tone="muted" align="center">
          {t.sync.footnote}
        </Text>
      </ScrollView>
    </Screen>
  );
}
