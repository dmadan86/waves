/**
 * The body of the group-settings Other currencies sheet: a header (tile, title,
 * subtitle, close), one card per added currency, an "Add a currency" card and a
 * short note about how rates behave.
 *
 * The note says only what is true: a rate is fetched once, when the currency is
 * added, then pinned. Nothing here refreshes it, and bills already saved keep
 * the rate they were added with.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { type TripRateStore, TripRatesCard } from '@/components/TripRates';
import { useStrings } from '@/i18n';

export function OtherCurrenciesSheetBody({
  store,
  groupCurrency,
  canEdit,
  forTrip,
  onClose,
}: {
  store: TripRateStore;
  groupCurrency: string;
  canEdit: boolean;
  forTrip: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  return (
    <View style={{ flex: 1, gap: theme.spacing.lg }}>
      {/* Header: tile, title and subtitle, close. */}
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons
            name="database-outline"
            size={iconSize.lg}
            color={theme.color.brand}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" accessibilityRole="header">
            {t.fx.otherCurrencies}
          </Text>
          <Text variant="caption" tone="muted">
            {forTrip ? t.fx.otherCurrenciesSubtitleTrip : t.fx.otherCurrenciesSubtitleGroup}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
        </Pressable>
      </Row>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <TripRatesCard
          embedded
          cards
          store={store}
          groupCurrency={groupCurrency}
          canEdit={canEdit}
        />

        <Row
          style={{
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={iconSize.lg}
            color={theme.color.textMuted}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" tone="muted">
              {t.fx.ratesInfoFetched}
            </Text>
            <Text variant="caption" tone="muted">
              {t.fx.ratesInfoKept}
            </Text>
          </View>
        </Row>
      </ScrollView>
    </View>
  );
}
