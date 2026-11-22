/** Every need Home's "Needs you" card ranks, with the same rows and actions. */

import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useTabBarClearance, useTheme } from '@waves/ui';

import { NeedsYouCard } from '@/components/home/HomeToday';
import { PlainHeader } from '@/components/standard';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useViewerId } from '@/lib/auth';
import { useDefaultCurrency } from '@/lib/currency';

export default function NeedsScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const ledger = usePersonalLedger();
  const currency = useDefaultCurrency();
  const { hidden } = usePersonalAmountsHidden();
  const [today] = useState(() => todayIso());

  return (
    <View style={{ flex: 1 }}>
      <PlainHeader title={t.homeToday.needsYou} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.lg,
        }}
      >
        <NeedsYouCard
          all
          ledger={{ txns: ledger.txns, recurrings: ledger.recurrings, currency, today }}
          viewerId={viewerId}
          hidden={hidden}
        />
      </ScrollView>
    </View>
  );
}
