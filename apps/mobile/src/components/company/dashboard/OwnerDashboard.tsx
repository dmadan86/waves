/**
 * The owner's company Overview (first tab of the company bar): stats, quick actions,
 * hierarchy and recent activity. People, Pending, Payments and More are their own screens
 * (see components/company/bar). Waves records money; it never moves it.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { View } from 'react-native';

import { dashboardStats } from '@waves/core';
import { iconSize, useTheme } from '@waves/ui';

import { SectionShell } from '@/components/company/bar/SectionShell';
import { PendingCard } from '@/components/company/dashboard/PendingCard';
import {
  InviteBanner,
  PersonLine,
  QuickActions,
  RecentActivity,
  RolePill,
  SectionCard,
  StatTriple,
  useMoney,
} from '@/components/company/dashboard/parts';
import { WorkdayTiles } from '@/components/company/WorkdayEntries';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useCompanyEntries } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function OwnerDashboard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const fmt = useMoney(view.currency);
  const [showAllRecent, setShowAllRecent] = useState(false);

  const live = view.members.filter((m) => !m.left_at);
  const owners = live.filter((m) => m.role === 'admin');
  const managers = live.filter((m) => m.role === 'manager');
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
  const teamOf = (managerId: string): number =>
    employees.filter((m) => m.manager_id === managerId).length;
  const thread = (memberId: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${memberId}`);
  const month = todayIso().slice(0, 7);
  const monthBudget = (managerId: string): bigint =>
    view.entries
      .filter(
        (e) =>
          e.kind === 'allocation' &&
          !e.deleted &&
          e.memberId === managerId &&
          e.occurredOn.slice(0, 7) === month,
      )
      .reduce((sum, e) => sum + e.amount, 0n);

  return (
    <SectionShell groupId={groupId} view={view} overview>
      <>
        <PendingCard groupId={groupId} />
        <StatTriple
          showCompanySpend={view.entries.some((e) => e.paidByCompany && !e.deleted)}
          stats={stats}
          currency={view.currency}
          onOwes={() => router.replace(`/group/${groupId}/company-payments`)}
        />
        <QuickActions
          actions={[
            {
              icon: 'person-add-outline',
              label: t.company.qaInvite,
              onPress: () => router.push(`/group/${groupId}/invite`),
            },
            {
              icon: 'git-network-outline',
              label: t.company.qaHierarchy,
              onPress: () => router.push(`/group/${groupId}/company-hierarchy`),
            },
            {
              icon: 'paper-plane-outline',
              label: t.company.qaRecord,
              onPress: () => router.push(`/group/${groupId}/company-wages`),
            },
          ]}
        />
        <WorkdayTiles groupId={groupId} />
        <InviteBanner
          title={t.company.promoTitle}
          body={t.company.promoBody}
          onPress={() => router.push(`/group/${groupId}/invite`)}
        />
        <SectionCard
          icon="people-outline"
          title={t.company.hierTitle}
          onViewAll={() => router.push(`/group/${groupId}/company-hierarchy`)}
        >
          {view.me ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons
                name="chevron-down"
                size={iconSize.sm}
                color={theme.color.textMuted}
                style={{ marginEnd: 4 }}
              />
              <View style={{ flex: 1 }}>
                <PersonLine
                  avatar={<PersonAvatar member={view.me} name={displayName(view.me)} size={36} />}
                  title={fill(t.company.nameYou, {
                    name: displayName(view.me, null, null, t.misc.someone),
                  })}
                  accessory={
                    <>
                      <MaterialCommunityIcons name="crown" size={14} color="#F5B301" />
                      <RolePill label={t.company.pillOwner} />
                    </>
                  }
                  subtitle={`${plural(locale, owners.length, t.company.ownerCount)} · ${t.company.overallControl}`}
                  count={String(live.length - owners.length)}
                  onPress={() => router.push(`/group/${groupId}/company-hierarchy`)}
                />
              </View>
            </View>
          ) : null}
          {managers.map((m, i) => (
            <View key={m.id} style={{ marginStart: 9, paddingStart: 20 }}>
              <View
                style={{
                  position: 'absolute',
                  start: 0,
                  top: 0,
                  height: i === managers.length - 1 ? '50%' : '100%',
                  borderStartWidth: 1.5,
                  borderColor: theme.color.border,
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  start: 0,
                  top: '50%',
                  width: 12,
                  borderTopWidth: 1.5,
                  borderColor: theme.color.border,
                }}
              />
              <PersonLine
                avatar={
                  <PersonAvatar
                    member={m}
                    name={displayName(m)}
                    ghost={isGhost(m)}
                    size={36}
                    tint={(['pink', 'sky', 'mint', 'peach'] as const)[i % 4]}
                  />
                }
                title={displayName(m, null, null, t.misc.someone)}
                accessory={<RolePill label={t.company.manager} />}
                subtitle={[
                  m.employee_id,
                  monthBudget(m.id) > 0n
                    ? fill(t.company.budgetPerMonth, { amount: fmt(monthBudget(m.id)) })
                    : t.eventOrganizer.noBudgetSet,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                count={String(teamOf(m.id))}
                onPress={() => thread(m.id)}
              />
            </View>
          ))}
        </SectionCard>
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
