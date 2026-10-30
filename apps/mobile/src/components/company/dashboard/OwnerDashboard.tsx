/**
 * The owner's company Overview (first tab of the company bar), as drawn in the owner's mockup:
 * attendance, money, tasks and urgent, what is due and recent activity.
 * People, Pending, Payments and More are their own screens. Waves records money; it never moves it.
 */

import { RecentCompanyActivity } from '@/components/company/CompanyActivityFeed';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { MoneyCards, DuePaymentsCard } from '@/components/company/dashboard/OverviewMoney';
import { OverviewTop } from '@/components/company/dashboard/OverviewTop';
import { useCompanyEntries } from '@/data/companyEntries';

export function OwnerDashboard({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  return (
    <SectionShell groupId={groupId} view={view} overview>
      <>
        <OverviewTop
          groupId={groupId}
          afterAttendanceCard={<MoneyCards groupId={groupId} />}
          afterAttendance={<DuePaymentsCard groupId={groupId} />}
        />
        {view.ready ? <RecentCompanyActivity groupId={groupId} /> : null}
      </>
    </SectionShell>
  );
}
