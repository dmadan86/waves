/**
 * The owner's company Overview (first tab of the company bar), as drawn in the owner's mockup:
 * attendance, money, tasks and urgent, what is due and recent activity, in the order the owner chose
 * (⋮ › Edit layout, or hold the cards). People, Pending, Payments and More are their own screens.
 * Waves records money; it never moves it.
 */

import { useState } from 'react';

import { RecentCompanyActivity } from '@/components/company/CompanyActivityFeed';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { LayoutEditor, OverviewCards } from '@/components/company/dashboard/OverviewGrid';
import { MoneyCards } from '@/components/company/dashboard/OverviewMoney';
import { OverviewTop } from '@/components/company/dashboard/OverviewTop';
import { OverviewUpcoming } from '@/components/company/dashboard/OverviewUpcoming';
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
                  attendance: own.attendance,
                  attention: own.attention,
                  money: <MoneyCards groupId={groupId} />,
                  upcoming: <OverviewUpcoming groupId={groupId} />,
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
