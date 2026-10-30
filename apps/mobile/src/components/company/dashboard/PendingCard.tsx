import { View } from 'react-native';

import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { Text } from '@waves/ui';
import { useCompanyEntries } from '@/data/companyEntries';
import { useUnpaidBills } from '@/data/companyDocuments';
import { usePendingVendorBills } from '@/data/companyVendors';
import { useWorkdayCounts } from '@/data/companyWorkday';
import { useStrings, fill } from '@/i18n';
import { router } from '@/lib/navigation';
import { awaitingApprovals } from '@/lib/companyPending';

export function PendingCard({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  const vendorBills = usePendingVendorBills(groupId).count;
  const unpaid = useUnpaidBills(groupId).count;
  const { blocked, unmarked } = useWorkdayCounts(groupId);
  const approvals = awaitingApprovals(view).length;
  const requests = view.isOwner
    ? view.entries.filter((e) => e.kind === 'pool_request' && !e.deleted).length
    : 0;
  const { t } = useStrings();
  const rows = [
    { label: t.company.pendingApprovals, count: approvals, route: 'company-pending' },
    { label: t.company.budgetRequests, count: requests, route: 'company-pending' },
    { label: t.company.pendingVendorBills, count: vendorBills, route: 'company-vendors' },
    { label: t.company.pendingUnpaidBills, count: unpaid, route: 'company-bills' },
    { label: t.company.pendingBlockedTasks, count: blocked, route: 'company-work' },
    { label: t.company.pendingUnmarked, count: unmarked, route: 'company-attendance' },
  ]
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (!total) return null;
  return (
    <View>
      <SectionHeader
        title={t.company.workPending}
        trailing={<Text variant="caption">{total}</Text>}
      />
      <StandardCard>
        {rows.slice(0, 3).map((row, index) => (
          <ListRow
            key={row.label}
            title={fill(row.label, { n: String(row.count) })}
            amount={String(row.count)}
            divider={index < Math.min(rows.length, 3) - 1}
          />
        ))}
        <ListRow
          title={t.company.workSeeAll}
          onPress={() => router.push(`/group/${groupId}/company-pending`)}
        />
      </StandardCard>
    </View>
  );
}
