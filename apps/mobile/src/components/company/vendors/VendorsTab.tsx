import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { filterVendorRows, vendorDashboard, type VendorFilter } from '@waves/core';
import { ChipRow, Text, useTheme } from '@waves/ui';

import { SaveButton } from '@/components/company/EntryForm';
import { Pill, StatusChip, useVendorFormat } from '@/components/company/vendors/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, StandardCard } from '@/components/standard';
import { useCompanySuspended } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { todayIso } from '@/data/personal';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

function Tile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        gap: 2,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surfaceMuted,
      }}
    >
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text tabular style={{ fontWeight: '700' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** The Vendors dashboard body: overview card, filters, rows. `query` is the header's search text. */
export function VendorsTab({ groupId, query }: { groupId: string; query: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.companyVendors;
  const raw = useCompanyVendors(groupId);
  const suspended = useCompanySuspended(groupId);
  const canManage = raw.canManage && !suspended;
  const fmt = useVendorFormat(raw.currency).money;
  const [filter, setFilter] = useState<VendorFilter>('all');
  const dash = useMemo(
    () => vendorDashboard(raw.vendors, raw.lines, todayIso()),
    [raw.vendors, raw.lines],
  );
  const rows = filterVendorRows(dash.rows, filter, query);
  const open = (id: string) => router.push(`/group/${groupId}/company-vendor?vendorId=${id}`);
  return (
    <View style={{ gap: theme.spacing.lg }}>
      <StandardCard style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" tone="muted">
              {s.totalToPay}
            </Text>
            <Text tabular style={{ fontSize: 28, fontWeight: '800' }} numberOfLines={1}>
              {fmt(dash.totalToPay)}
            </Text>
          </View>
          {dash.overdueVendors > 0 ? (
            <Pill label={fill(s.overdueCount, { n: String(dash.overdueVendors) })} tone="bad" />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Tile label={s.paidThisMonth} value={fmt(dash.paidThisMonth)} />
          <Tile label={s.billsToReview} value={String(dash.billsToReview)} />
        </View>
      </StandardCard>
      <ChipRow
        variant="brand"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `${s.filterAll} ${dash.counts.all}` },
          { value: 'toPay', label: `${s.filterToPay} ${dash.counts.toPay}` },
          { value: 'settled', label: `${s.settled} ${dash.counts.settled}` },
          { value: 'toReview', label: `${s.filterToReview} ${dash.counts.toReview}` },
        ]}
      />
      <StandardCard>
        {rows.length === 0 ? (
          <Text tone="muted">{dash.rows.length === 0 ? s.emptyList : s.noMatch}</Text>
        ) : (
          rows.map((row, index) => {
            const { vendor, balance } = row;
            return (
              <ListRow
                key={vendor.id}
                title={vendor.name}
                titleLines={2}
                leading={<PersonAvatar name={vendor.name} size={40} />}
                subtitle={vendor.category ?? row.latest?.note ?? vendor.phone ?? undefined}
                amount={balance < 0n ? fill(s.hasAdvance, { amount: fmt(-balance) }) : fmt(balance)}
                footer={<StatusChip status={row.status} />}
                onPress={() => open(vendor.id)}
                divider={index < rows.length - 1}
              />
            );
          })
        )}
      </StandardCard>
      {canManage ? (
        <SaveButton
          label={s.addVendor}
          disabled={false}
          onPress={() => router.push(`/group/${groupId}/company-vendor-add`)}
        />
      ) : null}
    </View>
  );
}
