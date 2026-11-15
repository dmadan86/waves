import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TextInput, View } from 'react-native';

import { filterVendorRows, vendorDashboard, type VendorFilter, type VendorRow } from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { RowMenu, StatTiles } from '@/components/company/listParts';
import { useVendorFormat } from '@/components/company/vendors/parts';
import { ListRow, RowTile, StandardCard } from '@/components/standard';
import { useCompanyVendors } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

const FILTERS: readonly VendorFilter[] = ['all', 'toPay', 'settled', 'toReview', 'overdue'];

/** The Vendors dashboard body: four stat tiles, search + filter, one card of vendors. */
export function VendorsTab({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const c = t.companyClients; // the shared Total / Active / Inactive words
  const raw = useCompanyVendors(groupId);
  const fmt = useVendorFormat(raw.currency).money;
  const [filter, setFilter] = useState<VendorFilter>('all');
  const [query, setQuery] = useState('');
  const dash = useMemo(
    () => vendorDashboard(raw.vendors, raw.lines, todayIso(), 'all'),
    [raw.vendors, raw.lines],
  );
  // Pending: bills waiting to be confirmed. Inactive: nothing ever recorded. Else active.
  const kind = (r: VendorRow) => (r.toReview > 0 ? 'pending' : r.latest ? 'active' : 'inactive');
  const tally = (k: string) => dash.rows.filter((r) => kind(r) === k).length;
  const rows = filterVendorRows(dash.rows, filter, query);
  const open = (id: string) => router.push(`/group/${groupId}/company-vendor?vendorId=${id}`);
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
      <StatTiles
        tiles={[
          {
            icon: 'storefront-outline',
            value: dash.rows.length,
            label: c.statTotal,
            fg: theme.color.brand,
            bg: theme.color.brandSoft,
          },
          {
            icon: 'checkmark-circle-outline',
            value: tally('active'),
            label: c.statActive,
            fg: theme.color.positive,
            bg: theme.color.positiveSoft,
          },
          {
            icon: 'time-outline',
            value: tally('pending'),
            label: s.pending,
            fg: theme.color.warning,
            bg: theme.color.warningSoft,
          },
          {
            icon: 'information-circle-outline',
            value: tally('inactive'),
            label: c.statInactive,
            fg: theme.color.textMuted,
            bg: theme.color.surfaceMuted,
          },
        ]}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            minHeight: 44,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.surface,
          }}
        >
          <Ionicons name="search" size={18} color={theme.color.textMuted} />
          <TextInput
            accessibilityLabel={s.search}
            placeholder={s.search}
            placeholderTextColor={theme.color.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            style={{ flex: 1, color: theme.color.text, fontSize: 16, padding: 0 }}
          />
        </View>
        <RowMenu
          icon="filter"
          label={`${c.filterTitle}: ${filterLabel[filter]}`}
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
  const overdue = row.overdue > 0n;
  const k = overdue ? 'overdue' : row.toReview > 0 ? 'pending' : row.latest ? 'active' : 'inactive';
  const c = theme.color;
  const w = t.companyClients;
  const pill = {
    active: [w.statActive, c.positive, c.positiveSoft],
    pending: [s.pending, c.warning, c.warningSoft],
    overdue: [s.statusOverdue, c.negative, c.negativeSoft],
    inactive: [w.statInactive, c.textMuted, c.surfaceMuted],
  }[k];
  const standing = balance < 0n ? s.advance : balance === 0n ? s.settled : s.filterToPay;
  return (
    <ListRow
      divider={!last}
      title={vendor.name}
      subtitle={[
        vendor.categories.join(', '),
        balance === 0n ? standing : `${money(balance < 0n ? -balance : balance)} ${standing}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      leading={
        <RowTile tint={c.brandSoft}>
          <Ionicons name="storefront-outline" size={20} color={c.brand} />
        </RowTile>
      }
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            style={{
              backgroundColor: pill[2],
              borderRadius: theme.radius.sm,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 2,
            }}
          >
            <Text variant="micro" style={{ color: pill[1], fontWeight: '700' }}>
              {pill[0]}
            </Text>
          </View>
          <RowMenu
            label={`${s.more}: ${vendor.name}`}
            items={[{ icon: 'open-outline', label: t.companyClients.open, onPress }]}
          />
        </View>
      }
      onPress={onPress}
    />
  );
}
