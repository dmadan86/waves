/**
 * Your data — the hub that surfaces Export and Import as two distinct choices.
 *
 * One compact page, two stacked sections, each holding a single row. The hub
 * avoids the friction of navigating to Export to find Import, or vice versa,
 * without folding either flow into this page: both sub-screens keep their full
 * UI, their existing routes (/settings/export, /settings/import), and every
 * deep link and Privacy/Delete-account link that already points to them.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { iconSize, useTabBarClearance, useTheme } from '@waves/ui';

import { ListRow, PlainHeader, RowTile, SectionHeader, StandardCard } from '@/components/standard';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export default function DataScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <PlainHeader title={t.yourData.title} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Export section */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.yourData.exportSection} />
          <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
            <ListRow
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons name="download-outline" size={iconSize.lg} color={theme.color.brand} />
                </RowTile>
              }
              title={t.exportData.title}
              subtitle={t.yourData.exportHint}
              onPress={() => router.push('/settings/export')}
            />
          </StandardCard>
        </View>

        {/* Import section */}
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.yourData.importSection} />
          <StandardCard style={{ paddingVertical: theme.spacing.sm }}>
            <ListRow
              leading={
                <RowTile tint={theme.color.brandSoft}>
                  <Ionicons
                    name="cloud-upload-outline"
                    size={iconSize.lg}
                    color={theme.color.brand}
                  />
                </RowTile>
              }
              title={t.account.importSplitwise}
              subtitle={t.yourData.importHint}
              onPress={() => router.push('/settings/import')}
            />
          </StandardCard>
        </View>
      </ScrollView>
    </View>
  );
}
