/**
 * The owner's company Overview (first tab of the company bar): stats, quick actions,
 * today, money and recent activity. People, Pending, Payments and More are their own screens
 * (see components/company/bar). Waves records money; it never moves it.
 */

import { useMemo, useState } from 'react';

import { dashboardStats } from '@waves/core';

import { SectionShell } from '@/components/company/bar/SectionShell';
import { ComingUpCard } from '@/components/company/dashboard/ComingUpCard';
import { PendingCard } from '@/components/company/dashboard/PendingCard';
import { TodayTiles } from '@/components/company/dashboard/TodayTiles';
import {
  InviteBanner,
  QuickActions,
  RecentActivity,
  StatTriple,
} from '@/components/company/dashboard/parts';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function OwnerDashboard({ groupId }: { groupId: string }) {
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const [showAllRecent, setShowAllRecent] = useState(false);

  const live = view.members.filter((m) => !m.left_at);
  const employees = live.filter((m) => m.role === 'member');
  const stats = useMemo(
    () =>
      dashboardStats(
        view.entries,
        live.map((m) => m.id),
        todayIso(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.entries, view.members],
  );

  return (
    <SectionShell groupId={groupId} view={view} overview>
      <>
        <PendingCard groupId={groupId} />
        <TodayTiles groupId={groupId} hasEmployees={employees.length > 0} />
        <StatTriple
          showCompanySpend={view.entries.some((e) => e.paidByCompany && !e.deleted)}
          stats={stats}
          currency={view.currency}
          onOwes={() => router.replace(`/group/${groupId}/company-payments`)}
        />
        <QuickActions
          actions={[
            {
              icon: 'paper-plane-outline',
              label: t.company.qaRecord,
              onPress: () => router.push(`/group/${groupId}/company-wages`),
            },
            {
              icon: 'add-circle-outline',
              label: t.company.qaAddTask,
              onPress: () => router.push(`/group/${groupId}/company-work`),
            },
            ...(employees.length < 2
              ? [
                  {
                    icon: 'person-add-outline' as const,
                    label: t.company.qaInvite,
                    onPress: () => router.push(`/group/${groupId}/invite`),
                  },
                ]
              : []),
          ]}
        />
        {employees.length < 2 ? (
          <InviteBanner
            title={t.company.promoTitle}
            body={t.company.promoBody}
            onPress={() => router.push(`/group/${groupId}/invite`)}
          />
        ) : null}
        <ComingUpCard groupId={groupId} currency={view.currency} />
        <RecentActivity
          groupId={groupId}
          view={view}
          entries={view.entries}
          limit={showAllRecent ? view.entries.length : 4}
          header={{
            title: t.company.recentTitle,
            // Expand in place: the payments tab hides expenses and allowances.
            onViewAll: showAllRecent ? undefined : () => setShowAllRecent(true),
          }}
        />
      </>
    </SectionShell>
  );
}
