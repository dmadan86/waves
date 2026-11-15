/**
 * The owner's company Overview (first tab of the company bar), as drawn in the owner's mockup:
 * attendance, money, tasks and urgent, what is due and recent activity, in the order the owner chose
 * (⋮ › Edit layout, or hold the cards). People, Pending, Payments and More are their own screens.
 * Waves records money; it never moves it.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { RecentCompanyActivity } from '@/components/company/CompanyActivityFeed';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { LayoutEditor, OverviewCards } from '@/components/company/dashboard/OverviewGrid';
import {
  ComingUpRow,
  GlanceTiles,
  NeedsAttention,
} from '@/components/company/dashboard/OverviewHome';
import { MoneyCards } from '@/components/company/dashboard/OverviewMoney';
import {
  CompanyChips,
  QuickActions,
  TaskBoard,
} from '@/components/company/dashboard/OverviewTaskBoard';
import { OverviewTop } from '@/components/company/dashboard/OverviewTop';
import { OverviewUpcoming } from '@/components/company/dashboard/OverviewUpcoming';
import { UpcomingTimeOff } from '@/components/company/UpcomingTimeOff';
import { useCompanyEntries } from '@/data/companyEntries';
import { useStrings } from '@/i18n';
import { useOverviewLayout } from '@/lib/overviewLayoutStore';

export function OwnerDashboard({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  const { t } = useStrings();
  const { layout, save, reset } = useOverviewLayout(groupId, 'owner');
  const [editing, setEditing] = useState(false);
  return (
    <SectionShell
      groupId={groupId}
      view={view}
      overview
      editing={editing}
      menuItems={[
        { icon: 'grid-outline', label: t.company.ovEditLayout, onPress: () => setEditing(true) },
      ]}
    >
      {editing ? (
        <LayoutEditor
          role="owner"
          layout={layout}
          onChange={save}
          onReset={reset}
          onDone={() => setEditing(false)}
        />
      ) : (
        <OverviewTop
          groupId={groupId}
          compose={(own) => (
            <>
              <OverviewCards
                layout={layout}
                onEdit={() => setEditing(true)}
                cards={{
                  glance: (
                    <View style={{ gap: 12 }}>
                      <CompanyChips groupId={groupId} />
                      <GlanceTiles groupId={groupId} />
                    </View>
                  ),
                  needs: (
                    <View style={{ gap: 12 }}>
                      <TaskBoard groupId={groupId} />
                      <NeedsAttention groupId={groupId} approvalsOnly />
                    </View>
                  ),
                  moneyActions: <QuickActions groupId={groupId} />,
                  comingUp: <ComingUpRow groupId={groupId} />,
                  attendance: own.attendance,
                  attention: own.attention,
                  money: <MoneyCards groupId={groupId} />,
                  upcoming: (
                    <View style={{ gap: 12 }}>
                      <OverviewUpcoming groupId={groupId} />
                      <UpcomingTimeOff groupId={groupId} company />
                    </View>
                  ),
                  activity: view.ready ? <RecentCompanyActivity groupId={groupId} /> : null,
                }}
              />
              {own.sheet}
            </>
          )}
        />
      )}
    </SectionShell>
  );
}
