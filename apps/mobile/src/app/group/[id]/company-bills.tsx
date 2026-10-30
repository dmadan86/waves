import { useCompanySuspended } from '@/data/companyEntries';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import {
  billDueMinor,
  docNumberLabel,
  format,
  money,
  unpaidBills,
  unpaidBillsTotal,
  type CurrencyCode,
} from '@waves/core';
import { Button, Screen, Sheet, Text, useTheme } from '@waves/ui';
import { ListRow, PlainHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyDocs } from '@/data/companyDocuments';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

export default function CompanyBillsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const view = useCompanyDocs(id);
  const { t, locale } = useStrings();
  const c = t.companyDocs;
  const theme = useTheme();
  const clearance = useBottomClearance();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const fmt = (v: bigint) => format(money(v, view.currency as CurrencyCode), { locale });
  const live = view.docs.filter((d) => !d.deleted);
  const docs =
    filter === 'unpaid'
      ? unpaidBills(live)
      : live.filter((d) => filter === 'all' || d.docType === filter);
  const suspended = useCompanySuspended(id);
  if (!view.canUse) return null;
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={c.title}
        trailing={
          suspended ? undefined : (
            <Button label="+" variant="brand" onPress={() => setCreating(true)} />
          )
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedPills
            options={[
              { value: 'all', label: c.all },
              { value: 'estimate', label: c.estimates },
              { value: 'bill', label: c.bills },
              { value: 'unpaid', label: c.unpaid },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </ScrollView>
        <Text tone="muted">{fill(c.unpaidTotal, { amount: fmt(unpaidBillsTotal(live)) })}</Text>
        {docs.length ? (
          <StandardCard>
            {docs.map((d) => (
              <ListRow
                key={d.id}
                title={`${docNumberLabel(d.docType, d.number)} · ${d.customerName}`}
                subtitle={`${showDate(d.docDate, locale)}${d.number === null ? ` · ${c.syncing}` : ''}`}
                amount={fmt(d.totalMinor)}
                footer={
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      backgroundColor: theme.color.brandSoft,
                      borderRadius: theme.radius.pill,
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: theme.spacing.xs,
                    }}
                  >
                    <Text variant="micro">
                      {c[d.status]}
                      {d.status === 'part_paid'
                        ? ` · ${c.amountLeft}: ${fmt(billDueMinor(d.totalMinor, d.paidMinor))}`
                        : ''}
                    </Text>
                  </View>
                }
                onPress={() => router.push(`/group/${id}/company-bill?docId=${d.id}`)}
                divider
              />
            ))}
          </StandardCard>
        ) : view.ready ? (
          <Text tone="muted">{c.empty}</Text>
        ) : null}
      </ScrollView>
      <Sheet visible={creating} onClose={() => setCreating(false)} title={c.title}>
        {(['estimate', 'bill'] as const).map((type) => (
          <ListRow
            key={type}
            title={type === 'estimate' ? c.newEstimate : c.newBill}
            onPress={() => {
              setCreating(false);
              router.push(`/group/${id}/company-bill-form?type=${type}`);
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}
