import { useCompanySuspended } from '@/data/companyEntries';
import { useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  billDueMinor,
  docNumberLabel,
  format,
  money,
  unpaidBills,
  unpaidBillsTotal,
  type CurrencyCode,
} from '@waves/core';
import { iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { type MenuAnchor } from '@/components/SortMenu';
import { ListRow, PlainHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { useCompanyDocs } from '@/data/companyDocuments';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { showDate } from '@/lib/expenseDay';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';

export default function CompanyBillsScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const view = useCompanyDocs(id);
  const { t, locale } = useStrings();
  const c = t.companyDocs;
  const theme = useTheme();
  const clearance = useBottomClearance();
  const [filter, setFilter] = useState('all');
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const plusRef = useRef<View>(null);
  const create = (type: 'estimate' | 'bill') =>
    router.push(`/group/${id}/company-bill-form?type=${type}`);
  const fmt = (v: bigint) => format(money(v, view.currency as CurrencyCode), { locale });
  const live = view.docs.filter((d) => !d.deleted);
  const q = query.trim().toLowerCase();
  const docs = (
    filter === 'unpaid'
      ? unpaidBills(live)
      : live.filter((d) => filter === 'all' || d.docType === filter)
  ).filter(
    (d) =>
      !q || `${docNumberLabel(d.docType, d.number)} ${d.customerName}`.toLowerCase().includes(q),
  );
  const bills = live.filter((d) => d.docType === 'bill');
  const unpaid = unpaidBills(live);
  const paidTotal = bills.reduce((a, d) => a + d.paidMinor, 0n);
  const stats = [
    {
      label: c.total,
      amount: live.reduce((a, d) => a + d.totalMinor, 0n),
      count: fill(c.docsCount, { n: String(live.length) }),
      icon: 'document-text',
      color: '#16A34A',
      bg: '#ECFDF3',
    },
    {
      label: c.unpaid,
      amount: unpaidBillsTotal(live),
      count: fill(c.billsCount, { n: String(unpaid.length) }),
      icon: 'time',
      color: '#EA8A0C',
      bg: '#FFF4E5',
    },
    {
      label: c.paid,
      amount: paidTotal,
      count: fill(c.billsCount, { n: String(bills.filter((d) => d.paidMinor > 0n).length) }),
      icon: 'checkmark-circle',
      color: '#2563EB',
      bg: '#EAF2FF',
    },
  ] as const;
  const iconBtn = {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
  const suspended = useCompanySuspended(id);
  if (!view.canUse) return null;
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={c.title}
        trailing={
          <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={c.searchLabel}
              onPress={() => {
                setSearching((v) => !v);
                setQuery('');
              }}
              style={iconBtn}
            >
              <Ionicons
                name={searching ? 'close' : 'search'}
                size={iconSize.xl}
                color={theme.color.text}
              />
            </Pressable>
            {suspended ? null : (
              <Pressable
                ref={plusRef}
                accessibilityRole="button"
                accessibilityLabel={c.addLabel}
                onPress={() =>
                  measureAnchor(plusRef, (a) => {
                    setMenuAnchor(a);
                    setMenuOpen(true);
                  })
                }
                style={{ ...iconBtn, borderRadius: 20, backgroundColor: theme.color.brand }}
              >
                <Ionicons name="add" size={iconSize.xxl} color="#FFFFFF" />
              </Pressable>
            )}
          </Row>
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
      >
        {searching ? (
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={c.searchPlaceholder}
            placeholderTextColor={theme.color.textMuted}
            style={{
              height: 44,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface,
              color: theme.color.text,
            }}
          />
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          <SegmentedPills
            options={[
              { value: 'all', label: c.all, icon: 'layers-outline' },
              { value: 'estimate', label: c.estimates, icon: 'document-text-outline' },
              { value: 'bill', label: c.bills, icon: 'receipt-outline' },
              { value: 'unpaid', label: c.unpaid, icon: 'time-outline' },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </ScrollView>
        <Row style={{ gap: theme.spacing.sm }}>
          {stats.map((s) => (
            <View
              key={s.label}
              style={{
                flex: 1,
                padding: theme.spacing.md,
                borderRadius: theme.radius.lg,
                backgroundColor: s.bg,
                gap: theme.spacing.xs,
              }}
            >
              <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                <Ionicons name={s.icon} size={iconSize.md} color={s.color} />
                <Text variant="micro" style={{ color: '#374151' }}>
                  {s.label}
                </Text>
              </Row>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ fontWeight: '800', color: '#111827' }}
              >
                {fmt(s.amount)}
              </Text>
              <Text variant="micro" style={{ color: '#6B7280' }}>
                {s.count}
              </Text>
            </View>
          ))}
        </Row>
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
                      borderRadius: theme.radius.sm,
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
        ) : view.ready && live.length ? (
          <Text tone="muted">{c.noMatch}</Text>
        ) : view.ready ? (
          <View
            style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.xl }}
          >
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: theme.color.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="receipt-outline" size={56} color={theme.color.brand} />
            </View>
            <Text variant="heading" style={{ fontWeight: '800', textAlign: 'center' }}>
              {c.noDocsTitle}
            </Text>
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {c.noDocsBody}
            </Text>
            {suspended ? null : (
              <Row style={{ gap: theme.spacing.md, alignSelf: 'stretch' }}>
                {(['bill', 'estimate'] as const).map((type) => (
                  <Pressable
                    key={type}
                    accessibilityRole="button"
                    onPress={() => create(type)}
                    style={{
                      flex: 1,
                      height: 48,
                      borderRadius: theme.radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: type === 'bill' ? theme.color.brand : 'transparent',
                      borderWidth: 1.5,
                      borderColor: theme.color.brand,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '700',
                        color: type === 'bill' ? '#FFFFFF' : theme.color.brand,
                      }}
                    >
                      {type === 'bill' ? c.createBill : c.createEstimate}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            )}
          </View>
        ) : null}
      </ScrollView>
      <OverflowMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={menuAnchor}
        items={[
          { icon: 'receipt-outline', label: c.newBill, onPress: () => create('bill') },
          {
            icon: 'document-text-outline',
            label: c.newEstimate,
            onPress: () => create('estimate'),
          },
        ]}
      />
    </Screen>
  );
}
