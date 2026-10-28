/**
 * The owner's company home (the dashboard mockup): Overview, Employees, Managers,
 * Budgets and Payments. Everything is computed from the rows an owner can read.
 * Waves records money; it never moves it, so payments say "record".
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ScrollView, View } from 'react-native';

import { dashboardStats } from '@waves/core';
import { Screen, Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { ManagerCashRowPublic, OwnerCashList } from '@/components/company/CompanyCash';
import { CompanyRules } from '@/components/company/CompanyRules';
import { PendingApprovals } from '@/components/company/dashboard/PendingApprovals';
import { CompanySites, useAddSiteSheet } from '@/components/company/CompanySites';
import {
  DashBody,
  DashHeader,
  InviteBanner,
  PersonLine,
  SectionCard,
  TabPills,
  QuickActions,
  RecentActivity,
  RolePill,
  StatTriple,
  useMoney,
} from '@/components/company/dashboard/parts';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, StandardCard } from '@/components/standard';
import { useCompanyEntries, type CompanyView } from '@/data/companyEntries';
import { useSetMemberRole } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

type Tab = 'overview' | 'employees' | 'managers' | 'budgets' | 'payments';

export function OwnerDashboard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const fmt = useMoney(view.currency);
  const [tab, setTab] = useState<Tab>('overview');
  const [promoting, setPromoting] = useState(false);
  const role = useSetMemberRole(groupId);
  const addSite = useAddSiteSheet(groupId);

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
  const people = `/group/${groupId}/members`;
  const requests = view.entries
    .filter((e) => e.kind === 'pool_request' && !e.deleted)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  const tabs = (
    <TabPills
      options={[
        { value: 'overview' as Tab, label: t.company.tabOverview },
        { value: 'employees' as Tab, label: t.company.tabEmployees },
        { value: 'managers' as Tab, label: t.company.tabManagers },
        { value: 'budgets' as Tab, label: t.company.tabBudgets },
        { value: 'payments' as Tab, label: t.company.tabPayments },
      ]}
      value={tab}
      onChange={setTab}
    />
  );

  const monthBudget = (managerId: string): bigint => {
    const month = new Date().toISOString().slice(0, 7);
    return view.entries
      .filter(
        (e) =>
          e.kind === 'allocation' &&
          !e.deleted &&
          e.memberId === managerId &&
          e.occurredOn.slice(0, 7) === month,
      )
      .reduce((sum, e) => sum + e.amount, 0n);
  };

  const personRow = (m: (typeof live)[number], index: number, count: number, sub?: string) => (
    <ListRow
      key={m.id}
      leading={<PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={40} />}
      title={displayName(m, null, null, t.misc.someone)}
      subtitle={sub}
      onPress={() => thread(m.id)}
      divider={index < count - 1}
    />
  );
  const balanceWords = (id: string): string | undefined => {
    const net = dashboardStats(view.entries, [id], todayIso());
    if (net.owes > 0n)
      return fill(t.company.youOweName, { name: '', amount: fmt(net.owes) }).trim();
    return net.advancesOutstanding > 0n
      ? fill(t.company.hasOfYours, { name: '', amount: fmt(net.advancesOutstanding) }).trim()
      : t.company.settled;
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <DashHeader
          groupId={groupId}
          view={view}
          showGear
          subtitle={fill(t.company.countsLine, {
            e: String(employees.length),
            m: String(managers.length),
            o: String(owners.length),
          })}
          tabs={tabs}
        />
        <DashBody>
          {tab === 'overview' ? (
            <>
              <PendingApprovals groupId={groupId} view={view} />
              <StatTriple
                stats={stats}
                currency={view.currency}
                onOwes={() => setTab('payments')}
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
                    icon: 'wallet-outline',
                    label: t.company.qaBudgets,
                    onPress: () => setTab('budgets'),
                  },
                  {
                    icon: 'paper-plane-outline',
                    label: t.company.qaRecord,
                    onPress: () => router.push(`/group/${groupId}/company-wages`),
                  },
                ]}
              />
              {employees.length < 3 ? (
                <InviteBanner
                  title={t.company.promoTitle}
                  body={t.company.promoBody}
                  onPress={() => router.push(`/group/${groupId}/invite`)}
                />
              ) : null}
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
                        avatar={
                          <PersonAvatar member={view.me} name={displayName(view.me)} size={36} />
                        }
                        title={fill(t.company.nameYou, {
                          name: displayName(view.me, null, null, t.misc.someone),
                        })}
                        accessory={
                          <>
                            <MaterialCommunityIcons name="crown" size={14} color="#F5B301" />
                            <RolePill label={t.company.pillOwner} />
                          </>
                        }
                        subtitle={fill(t.company.ownersControl, { n: String(owners.length) })}
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
                        left: 0,
                        top: 0,
                        height: i === managers.length - 1 ? '50%' : '100%',
                        borderLeftWidth: 1.5,
                        borderColor: theme.color.border,
                      }}
                    />
                    <View
                      style={{
                        position: 'absolute',
                        left: 0,
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
                          tint="pink"
                        />
                      }
                      title={displayName(m, null, null, t.misc.someone)}
                      accessory={<RolePill label={t.company.manager} />}
                      subtitle={fill(t.company.budgetPerMonth, { amount: fmt(monthBudget(m.id)) })}
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
                limit={4}
                header={{ title: t.company.recentTitle, onViewAll: () => setTab('payments') }}
              />
            </>
          ) : null}

          {tab === 'employees' ? (
            <>
              <StandardCard>
                {employees.map((m, i) => personRow(m, i, employees.length, balanceWords(m.id)))}
                <ListRow
                  title={t.company.qaAddEmployee}
                  leading={
                    <Ionicons
                      name="person-add-outline"
                      size={iconSize.md}
                      color={theme.color.brand}
                    />
                  }
                  onPress={() => router.push(people)}
                />
              </StandardCard>
              <Text variant="caption" tone="muted">
                {t.company.historyMoves}
              </Text>
            </>
          ) : null}

          {tab === 'managers' ? (
            <>
              {managers.length === 0 ? (
                <Text variant="body" tone="muted">
                  {t.company.managersNone}
                </Text>
              ) : (
                <StandardCard>
                  {managers.map((m, i) => (
                    <ManagerCashRowPublic
                      key={m.id}
                      groupId={groupId}
                      view={view}
                      manager={m}
                      team={teamOf(m.id)}
                      onPress={() => thread(m.id)}
                      divider={i < managers.length - 1}
                    />
                  ))}
                </StandardCard>
              )}
              {employees.length > 0 ? (
                <ListRow
                  title={t.company.makeManagerPick}
                  leading={
                    <Ionicons name="ribbon-outline" size={iconSize.md} color={theme.color.brand} />
                  }
                  onPress={() => setPromoting(true)}
                />
              ) : null}
            </>
          ) : null}

          {tab === 'budgets' ? (
            <>
              <OwnerCashList groupId={groupId} view={view} />
              {managers.length === 0 ? (
                <Text variant="body" tone="muted">
                  {t.company.managersNone}
                </Text>
              ) : null}
              {requests.length > 0 ? (
                <>
                  <Text variant="title">{t.company.budgetRequests}</Text>
                  <StandardCard>
                    {requests.map((r, i) => {
                      const m = live.find((x) => x.id === r.memberId);
                      return (
                        <ListRow
                          key={r.id}
                          title={m ? displayName(m, null, null, t.misc.someone) : t.misc.someone}
                          subtitle={r.note ?? undefined}
                          amount={fmt(r.amount)}
                          divider={i < requests.length - 1}
                        />
                      );
                    })}
                  </StandardCard>
                </>
              ) : null}
              <CompanySites groupId={groupId} view={view} />
              <ListRow
                title={t.company.addSite}
                leading={
                  <Ionicons name="location-outline" size={iconSize.md} color={theme.color.brand} />
                }
                onPress={addSite.open}
              />
            </>
          ) : null}

          {tab === 'payments' ? (
            <>
              <QuickActions
                actions={[
                  {
                    icon: 'cash-outline',
                    label: t.company.payWages,
                    onPress: () => router.push(`/group/${groupId}/company-wages`),
                  },
                  {
                    icon: 'arrow-up-circle-outline',
                    label: t.company.gaveMoney,
                    onPress: () => router.push(`/group/${groupId}/company-entry`),
                  },
                ]}
              />
              <RecentActivity groupId={groupId} view={view} entries={view.entries} />
              <CompanyRules groupId={groupId} view={view} />
            </>
          ) : null}
        </DashBody>
      </ScrollView>
      {addSite.sheet}
      <Sheet visible={promoting} onClose={() => setPromoting(false)} closeLabel={t.common.close}>
        <View>
          {employees.map((m, i) => (
            <ListRow
              key={m.id}
              leading={
                <PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={36} />
              }
              title={displayName(m, null, null, t.misc.someone)}
              onPress={() => {
                setPromoting(false);
                role.mutate({ memberId: m.id, role: 'manager' });
              }}
              divider={i < employees.length - 1}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

export type { CompanyView };
