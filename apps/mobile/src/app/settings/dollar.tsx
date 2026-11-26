/**
 * "Dollar ($) means": which dollar a bare $ is. Same list shape as Appearance.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import {
  Card,
  directionalIcon,
  IconButton,
  iconSize,
  ListRow,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { DOLLAR_ASK, DOLLAR_CURRENCY_CODES } from '@waves/core';

import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useDollarMeans } from '@/lib/dollarMeansStore';
import { currencyName } from '@/lib/tripRates';

export default function DollarSettingsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { means, setMeans } = useDollarMeans();

  const rows = [
    { key: DOLLAR_ASK, title: t.account.dollarAsk, subtitle: '' },
    ...DOLLAR_CURRENCY_CODES.map((code) => ({
      key: code,
      title: code,
      subtitle: currencyName(code, locale) ?? '',
    })),
  ];

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.account.dollarRow}</Text>
        </View>
        <View style={{ width: 44 }} />
      </Row>

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
            const chosen = means === row.key;
            return (
              <View key={row.key}>
                <ListRow
                  title={row.title}
                  subtitle={row.subtitle || undefined}
                  onPress={() => setMeans(row.key)}
                  // A picker row, not a door: choosing is idempotent and every
                  // tap should land.
                  repeatable
                  accessibilityLabel={`${row.title}${chosen ? ', selected' : ''}`}
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
          {t.account.dollarFootnote}
        </Text>
      </ScrollView>
    </Screen>
  );
}
