/** "Your dates": every private date, plus the festival reminders and their switches. */

import { ScrollView, View } from 'react-native';
import { Button, Row, Screen, Text, Toggle, useTabBarClearance, useTheme } from '@waves/ui';
import { defaultFestivals } from '@waves/core';

import { ListRow, PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { usePersonalDates } from '@/data/personalDates';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { setFestivalOn, useDatePrefs } from '@/lib/dateReminders/store';
import { router } from '@/lib/navigation';

export default function DatesScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const { profile } = useAuth();
  const dates = usePersonalDates();
  const { festivalsOn } = useDatePrefs();

  const label = (d: (typeof dates)[number]): string =>
    d.name ? `${d.name} · ${t.dates.kinds[d.label]}` : t.dates.kinds[d.label];

  return (
    <Screen edges={[]}>
      <PlainHeader title={t.dates.title} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader
            title={t.dates.title}
            action={{ label: t.dates.addDate, onPress: () => router.push('/dates/edit') }}
          />
          <StandardCard>
            {dates.length ? (
              dates.map((d, i) => (
                <ListRow
                  key={d.id}
                  title={label(d)}
                  subtitle={new Date(2024, d.month - 1, d.day, 12).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'long',
                  })}
                  onPress={() => router.push({ pathname: '/dates/edit', params: { id: d.id } })}
                  divider={i < dates.length - 1}
                />
              ))
            ) : (
              <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  {t.dates.empty}
                </Text>
                <Button label={t.dates.addDate} onPress={() => router.push('/dates/edit')} />
              </Row>
            )}
          </StandardCard>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t.dates.festivalsTitle} />
          <Text variant="caption" tone="muted">
            {t.dates.festivalsHint}
          </Text>
          <StandardCard>
            {defaultFestivals(profile?.country_code).map((id, i, all) => (
              <ListRow
                key={id}
                title={t.dates.festivals[id]}
                divider={i < all.length - 1}
                repeatable
                trailing={
                  <Toggle
                    value={festivalsOn.includes(id)}
                    onValueChange={(on) => setFestivalOn(id, on)}
                    accessibilityLabel={t.dates.festivals[id]}
                  />
                }
              />
            ))}
          </StandardCard>
        </View>
      </ScrollView>
    </Screen>
  );
}
