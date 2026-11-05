import { useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  filterVendorRows,
  vendorDashboard,
  type VendorFilter,
  type VendorPeriod,
  type VendorRow,
} from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { useVendorFormat } from '@/components/company/vendors/parts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useGlass, StandardCard } from '@/components/standard';
import { type MenuAnchor } from '@/components/SortMenu';
import { useCompanyVendors } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

const PERIODS: readonly VendorPeriod[] = ['month', 'lastMonth', 'year', 'all'];
const FILTERS: readonly VendorFilter[] = ['all', 'toPay', 'settled', 'toReview', 'overdue'];
const ORANGE = '#A85F00';
const PURPLE = '#4B35B8';
const GREEN = '#17703C';

/** One column of the overview card; a tap filters the list to it (tap again clears). */
function Stat({
  icon,
  tone,
  value,
  label,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  value: number;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${value} ${label}`}
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        paddingVertical: theme.spacing.xs,
        borderRadius: theme.radius.md,
        backgroundColor: selected ? theme.color.surfaceMuted : undefined,
      }}
    >
      <Ionicons name={icon} size={20} color={tone} />
      <Text tabular style={{ fontSize: 20, fontWeight: '800' }}>
        {value}
      </Text>
      <Text variant="micro" numberOfLines={1} style={{ color: tone, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A pill that opens an anchored menu of choices. */
function Dropdown({
  icon,
  label,
  items,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  items: readonly OverflowMenuItem[];
}) {
  const theme = useTheme();
  const glass = useGlass();
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const show = () =>
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor(width > 0 ? { x, y, width, height } : null);
      setOpen(true);
    }) ?? setOpen(true);
  return (
    <View ref={ref} collapsable={false} style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={show}
        style={{
          height: 40,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.sm,
          backgroundColor: glass,
          borderWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        <Ionicons name={icon} size={18} color={theme.color.text} />
        <Text numberOfLines={1} style={{ flex: 1, fontWeight: '700' }}>
          {label}
        </Text>
        <Ionicons name="chevron-down" size={16} color={theme.color.text} />
      </Pressable>
      <OverflowMenu visible={open} onClose={() => setOpen(false)} items={items} anchor={anchor} />
    </View>
  );
}

/** The Vendors dashboard body: overview card, two dropdowns, rows. `query` is the header's search text. */
export function VendorsTab({ groupId, query }: { groupId: string; query: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const raw = useCompanyVendors(groupId);
  const fmt = useVendorFormat(raw.currency).money;
  const [filter, setFilter] = useState<VendorFilter>('all');
  const [period, setPeriod] = useState<VendorPeriod>('month');
  const dash = useMemo(
    () => vendorDashboard(raw.vendors, raw.lines, todayIso(), period),
    [raw.vendors, raw.lines, period],
  );
  const rows = filterVendorRows(dash.rows, filter, query);
  const open = (id: string) => router.push(`/group/${groupId}/company-vendor?vendorId=${id}`);
  const toggle = (f: VendorFilter) => setFilter(filter === f ? 'all' : f);
  const periodLabel: Record<VendorPeriod, string> = {
    month: s.periodMonth,
    lastMonth: s.periodLast,
    year: s.periodYear,
    all: s.periodAll,
  };
  const filterLabel: Record<VendorFilter, string> = {
    all: s.allVendors,
    toPay: s.filterToPay,
    settled: s.settled,
    toReview: s.pendingReview,
    overdue: s.statusOverdue,
    receipts: s.receipts,
  };
  const check = (on: boolean): keyof typeof Ionicons.glyphMap =>
    on ? 'checkmark' : 'ellipse-outline';
  return (
    <View style={{ gap: theme.spacing.lg }}>
      <StandardCard style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View style={{ flex: 1.2, minWidth: 0 }}>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {s.totalToPay}
          </Text>
          <Text
            tabular
            numberOfLines={1}
            adjustsFontSizeToFit
            style={{ fontSize: 24, fontWeight: '800' }}
          >
            {fmt(dash.totalToPay)}
          </Text>
        </View>
        <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center' }}>
          <Stat
            icon="clipboard-outline"
            tone={ORANGE}
            value={dash.billsToReview}
            label={s.pending}
            selected={filter === 'toReview'}
            onPress={() => toggle('toReview')}
          />
          <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }} />
          <Stat
            icon="receipt-outline"
            tone={PURPLE}
            value={dash.receipts}
            label={s.receipts}
            selected={filter === 'receipts'}
            onPress={() => toggle('receipts')}
          />
          <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }} />
          <Stat
            icon="checkmark-circle-outline"
            tone={GREEN}
            value={dash.counts.settled}
            label={s.settled}
            selected={filter === 'settled'}
            onPress={() => toggle('settled')}
          />
        </View>
      </StandardCard>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Dropdown
          icon="calendar-outline"
          label={periodLabel[period]}
          items={PERIODS.map((p) => ({
            icon: check(p === period),
            label: periodLabel[p],
            onPress: () => setPeriod(p),
          }))}
        />
        <Dropdown
          icon="filter-outline"
          label={filterLabel[filter]}
          items={FILTERS.map((f) => ({
            icon: check(f === filter),
            label: filterLabel[f],
            onPress: () => setFilter(f),
          }))}
        />
      </View>
      <StandardCard>
        {rows.length === 0 ? (
          <Text tone="muted">{dash.rows.length === 0 ? s.emptyList : s.noMatch}</Text>
        ) : (
          rows.map((row, index) => (
            <VendorRowView
              key={row.vendor.id}
              row={row}
              money={fmt}
              last={index === rows.length - 1}
              onPress={() => open(row.vendor.id)}
            />
          ))
        )}
      </StandardCard>
    </View>
  );
}

function VendorRowView({
  row,
  money,
  last,
  onPress,
}: {
  row: VendorRow;
  money: (v: bigint) => string;
  last: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const { vendor, balance } = row;
  // Same row as the Home dashboard's group row: one name line, one muted line,
  // the amount with its standing in small words under it.
  const extras = [
    row.toReview > 0 ? fill(s.pendingN, { n: String(row.toReview) }) : null,
    row.receipts > 0
      ? fill(row.receipts === 1 ? s.receiptOne : s.receiptMany, { n: String(row.receipts) })
      : null,
  ].filter(Boolean);
  const overdue = row.overdue > 0n;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <PersonAvatar name={vendor.name} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
            {vendor.name}
          </Text>
          {overdue ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 6,
                backgroundColor: theme.color.negativeSoft,
              }}
            >
              <Text variant="micro" tone="negative" style={{ fontWeight: '700' }}>
                {s.statusOverdue}
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {vendor.categories.join(' · ')}
          {extras.length > 0 ? (
            <Text variant="caption" style={{ color: theme.color.warning, fontWeight: '600' }}>
              {`${vendor.categories.length ? ' · ' : ''}${extras.join(' · ')}`}
            </Text>
          ) : null}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text tabular numberOfLines={1} style={{ fontWeight: '700' }}>
          {money(balance < 0n ? -balance : balance)}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {balance < 0n ? s.advance : balance === 0n ? s.settled : s.filterToPay}
        </Text>
      </View>
    </Pressable>
  );
}
