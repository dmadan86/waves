/**
 * The frame every company-bar screen shares: company header (name switcher, gear for
 * owners), a scrolling body that clears the bar and the add button. Back on a sub-tab goes
 * to Overview, on Overview to Home, so a deep link still lands on a sane stack.
 */

import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { ScrollView } from 'react-native';

import { Screen } from '@waves/ui';

import { DashBody, DashHeader, useCompanyCounts } from '@/components/company/dashboard/parts';
import type { CompanyView } from '@/data/companyEntries';
import { fill, plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router, switchTab } from '@/lib/navigation';

export function SectionShell({
  groupId,
  view,
  overview = false,
  ownerOnly = false,
  children,
}: {
  groupId: string;
  view: CompanyView;
  /** True on the Overview tab, whose Back is Home. */
  overview?: boolean;
  /** Budgets & sites: a manager who lands here is sent back to Overview. */
  ownerOnly?: boolean;
  children: ReactNode;
}) {
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const counts = useCompanyCounts();
  const live = view.members.filter((m) => !m.left_at);
  const manager = !view.isOwner && view.isManager;
  const team = live.filter((m) => m.role === 'member' && m.id !== view.me?.id);
  // An employee (or a stale deep link) has no company bar: send them to their own home.
  if (view.ready && (ownerOnly ? !view.isOwner : !view.isAdmin))
    return <Redirect href={`/group/${groupId}`} />;
  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <DashHeader
          groupId={groupId}
          view={view}
          showGear={view.isOwner}
          subtitle={
            manager
              ? fill(t.company.teamLine, {
                  employees: plural(locale, team.length, t.company.employeeCount),
                })
              : counts(live)
          }
          pill={manager ? t.company.manager : undefined}
          onBack={() => (overview ? switchTab('/') : router.replace(`/group/${groupId}`))}
        />
        <DashBody>{children}</DashBody>
      </ScrollView>
    </Screen>
  );
}
