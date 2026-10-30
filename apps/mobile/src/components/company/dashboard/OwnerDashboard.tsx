/**
 * The owner's company Overview (first tab of the company bar), as drawn in the owner's mockup:
 * today, headcount, money, tasks and urgent, attendance, what is due and recent activity.
 * People, Pending, Payments and More are their own screens. Waves records money; it never moves it.
 */

import { useState } from 'react';

import { SectionShell } from '@/components/company/bar/SectionShell';
import { OverviewMoney } from '@/components/company/dashboard/OverviewMoney';
import { OverviewTop } from '@/components/company/dashboard/OverviewTop';
import { RecentActivity } from '@/components/company/dashboard/parts';
import { useCompanyEntries } from '@/data/companyEntries';
import { useStrings } from '@/i18n';

export function OwnerDashboard({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const [showAllRecent, setShowAllRecent] = useState(false);
  return (
    <SectionShell groupId={groupId} view={view} overview>
      <>
        <OverviewTop groupId={groupId} />
        <OverviewMoney groupId={groupId} />
        {view.ready ? (
          <RecentActivity
            groupId={groupId}
            view={view}
            entries={view.entries}
            limit={showAllRecent ? view.entries.length : 4}
            header={{
              title: t.company.recentTitle,
              icon: false,
              // Expand in place: the payments tab hides expenses and allowances.
              onViewAll: showAllRecent ? undefined : () => setShowAllRecent(true),
            }}
          />
        ) : null}
      </>
    </SectionShell>
  );
}
