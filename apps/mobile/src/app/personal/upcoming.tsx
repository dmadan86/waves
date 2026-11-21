/** Upcoming & Reminders in full: bills the recurring rules expect, dates, and the setup to-do. */

import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { format, money } from '@waves/core';
import { Button, Screen, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { PlainHeader, StandardCard } from '@/components/standard';
import { UpcomingRowView, usePersonalUpcoming } from '@/components/personal/PersonalHomeParts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export default function PersonalUpcomingScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const ledger = usePersonalLedger();
  const [today] = useState(() => todayIso());
  const rows = usePersonalUpcoming({ ...ledger, currency: dc, today }, 0);
  return (
    <Screen edges={[]}>
      <PlainHeader title={t.personalHome.upcomingTitle} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
      >
        <StandardCard>
          {rows.length > 0 ? (
            rows.map((row, i) => (
              <UpcomingRowView
                key={row.key}
                row={row}
                fmt={(amount, currency) => format(money(amount, currency), { locale })}
                last={i === rows.length - 1}
              />
            ))
          ) : (
            <Text variant="caption" tone="muted">
              {t.personalHome.upcomingEmpty}
            </Text>
          )}
        </StandardCard>
        <View style={{ gap: theme.spacing.sm }}>
          <Button label={t.dates.addDate} onPress={() => router.push('/dates/edit')} />
          <Button variant="ghost" label={t.dates.title} onPress={() => router.push('/dates')} />
        </View>
      </ScrollView>
    </Screen>
  );
}
