import { useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { format, type MoneyDate } from '@waves/core';
import { iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { type MenuAnchor } from '@/components/SortMenu';
import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { withAlpha } from '@/components/company/dashboard/overviewKit';
import { ListRow, PlainHeader, StandardCard } from '@/components/standard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useMoneyDates } from '@/data/companyMoneyDates';
import { plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';
import {
  filterUpcoming,
  overdueTotal,
  upcomingCounts,
  type UpcomingFilter,
} from '@/lib/upcomingList';

const ICONS: Record<MoneyDate['kind'], keyof typeof Ionicons.glyphMap> = {
  wage: 'cash-outline',
  vendor_bill: 'receipt-outline',
  customer_bill: 'document-text-outline',
  advance: 'wallet-outline',
  recurring: 'repeat-outline',
};

/** The screen each kind already opens elsewhere in the app (the stored `route` is not reliable). */
function pathFor(groupId: string, item: MoneyDate): string {
  const key = item.id.slice(item.id.indexOf(':') + 1);
  const base = `/group/${groupId}`;
  if (item.kind === 'vendor_bill') return `${base}/company-vendor?vendorId=${key}`;
  if (item.kind === 'customer_bill') return `${base}/company-bill?docId=${key}`;
  if (item.kind === 'advance') return `${base}/member/${key}`;
  if (item.kind === 'recurring') return `${base}/recurring`;
  return `${base}/company-wages`;
}

function MoreButton({
  onOpen,
  label,
}: {
  onOpen: (anchor: MenuAnchor | null) => void;
  label: string;
}) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => measureAnchor(ref, onOpen)}
      style={{ width: 32, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="ellipsis-vertical" size={iconSize.lg} color={theme.color.textMuted} />
    </Pressable>
  );
}

function UpcomingBody({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useBottomClearance();
  const view = useCompanyEntries(groupId);
  // Payroll is the owner's; a manager never sees what the company owes.
  const all = useMoneyDates(groupId).filter((item) => item.kind !== 'wage' || view.isOwner);
  const [filter, setFilter] = useState<UpcomingFilter>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ item: MoneyDate; anchor: MenuAnchor | null } | null>(null);
  const counts = upcomingCounts(all);
  const items = filterUpcoming(all, filter, query);
  const money = (minor: bigint, currency: string) => format({ minor, currency }, { locale });
  const kindLabel: Record<MoneyDate['kind'], string> = {
    wage: t.calendar.kindWage,
    vendor_bill: t.calendar.kindVendorBill,
    customer_bill: t.calendar.kindCustomerBill,
    advance: t.calendar.kindAdvance,
    recurring: t.groupRecurring.title,
  };
  const open = (item: MoneyDate) => router.push(pathFor(groupId, item) as never);
  const menuItems: OverflowMenuItem[] = menu
    ? [
        {
          icon: 'open-outline',
          label: t.companyClients.open,
          route: pathFor(groupId, menu.item) as never,
        },
        ...(menu.item.kind === 'vendor_bill'
          ? [
              {
                icon: 'cash-outline',
                label: t.companyVendors.recordPayment,
                route:
                  `/group/${groupId}/company-vendor-payment?vendorId=${menu.item.id.slice(menu.item.id.indexOf(':') + 1)}` as never,
              } satisfies OverflowMenuItem,
            ]
          : []),
      ]
    : [];
  const pills: { value: UpcomingFilter; label: string; count: number }[] = [
    { value: 'all', label: t.calendar.filterAll, count: counts.all },
    { value: 'overdue', label: t.calendar.overdue, count: counts.overdue },
    { value: 'upcoming', label: t.calendar.upcoming, count: counts.upcoming },
  ];
  const red = theme.color.negative;
  const currency = all[0]?.currency ?? view.currency;
  const empty = query.trim()
    ? t.companyDocs.noMatch
    : filter === 'overdue'
      ? t.calendar.nothingOverdue
      : filter === 'upcoming'
        ? t.calendar.nothingUpcoming
        : t.calendar.nothingDue;
  return (
    <Screen edges={[]}>
      <PlainHeader
        title={t.calendar.upcoming}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.companyDocs.searchLabel}
            onPress={() => {
              setSearching((v) => !v);
              setQuery('');
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons
              name={searching ? 'close' : 'search'}
              size={iconSize.lg}
              color={theme.color.text}
            />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {searching ? (
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={t.companyDocs.searchPlaceholder}
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
        <Row style={{ gap: theme.spacing.sm }}>
          {pills.map((pill) => {
            const selected = pill.value === filter;
            return (
              <Pressable
                key={pill.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setFilter(pill.value)}
                hitSlop={{ top: 6, bottom: 6 }}
                style={{
                  minHeight: 36,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: selected ? theme.color.brand : theme.color.border,
                  backgroundColor: selected ? theme.color.brand : theme.color.surface,
                }}
              >
                <Text
                  variant="caption"
                  style={{ fontWeight: '600', color: selected ? '#FFFFFF' : theme.color.text }}
                >
                  {pill.label}
                </Text>
                <View
                  style={{
                    minWidth: 20,
                    paddingHorizontal: 6,
                    borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: selected ? withAlpha('#FFFFFF', 0.25) : theme.color.brandSoft,
                  }}
                >
                  <Text
                    variant="micro"
                    style={{
                      fontWeight: '700',
                      color: selected
                        ? '#FFFFFF'
                        : pill.value === 'overdue' && pill.count > 0
                          ? red
                          : theme.color.brand,
                    }}
                  >
                    {pill.count}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Row>
        {counts.overdue > 0 ? (
          <Row
            style={{
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radius.lg,
              backgroundColor: withAlpha(red, 0.08),
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: withAlpha(red, 0.12),
              }}
            >
              <Ionicons name="calendar-outline" size={iconSize.lg} color={red} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: red }}>
                {plural(locale, counts.overdue, t.calendar.overdueItems)}
              </Text>
              <Text variant="caption" tone="muted">
                {t.calendar.totalDue.replace('{amount}', money(overdueTotal(all), currency))}
              </Text>
            </View>
          </Row>
        ) : null}
        {items.length ? (
          <StandardCard>
            {items.map((item, index) => (
              <ListRow
                key={item.id}
                leading={
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons
                      name={ICONS[item.kind]}
                      size={iconSize.lg}
                      color={theme.color.brand}
                    />
                  </View>
                }
                title={item.title}
                subtitle={kindLabel[item.kind]}
                onPress={() => open(item)}
                divider={index < items.length - 1}
                // No amount (wages) means a chevron; ListRow draws it when there is no trailing.
                trailing={
                  item.amountMinor == null ? undefined : (
                    <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text tabular style={{ fontWeight: '700' }}>
                          {money(item.amountMinor, item.currency)}
                        </Text>
                        {item.overdue ? (
                          <View
                            style={{
                              paddingHorizontal: theme.spacing.sm,
                              paddingVertical: 2,
                              borderRadius: 10,
                              backgroundColor: withAlpha(red, 0.12),
                            }}
                          >
                            <Text variant="micro" style={{ fontWeight: '600', color: red }}>
                              {t.calendar.overdue}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <MoreButton
                        label={t.group.more}
                        onOpen={(anchor) => setMenu({ item, anchor })}
                      />
                    </Row>
                  )
                }
              />
            ))}
          </StandardCard>
        ) : (
          <Text tone="muted" style={{ textAlign: 'center', paddingTop: theme.spacing.xl }}>
            {empty}
          </Text>
        )}
      </ScrollView>
      <OverflowMenu
        visible={menu !== null}
        onClose={() => setMenu(null)}
        items={menuItems}
        anchor={menu?.anchor ?? null}
      />
    </Screen>
  );
}

export default function CompanyUpcomingScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id}>
      <UpcomingBody groupId={id} />
    </SuspendedGate>
  );
}
