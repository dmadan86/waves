/**
 * The owner's company home (the dashboard mockup): Overview, Employees, Managers,
 * Budgets and Payments. Everything is computed from the rows an owner can read.
 * Waves records money; it never moves it, so payments say "record".
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, View } from 'react-native';

import { dashboardStats } from '@waves/core';
import { Screen, Sheet, Text, directionalIcon, iconSize, useTheme } from '@waves/ui';

import { ManagerCashRowPublic, OwnerCashList } from '@/components/company/CompanyCash';
import { CompanyRules } from '@/components/company/CompanyRules';
import { BudgetArt, ReceiptArt } from '@/components/company/dashboard/art';
import { PendingApprovals } from '@/components/company/dashboard/PendingApprovals';
import { CompanySites, useAddSiteSheet } from '@/components/company/CompanySites';
import {
  ActionTile,
  BLUE,
  BLUE_SOFT,
  DashBody,
  GREEN,
  GREEN_SOFT,
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
import { useCompanyEntries, useCompanyProjects, type CompanyView } from '@/data/companyEntries';
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
  const sites = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  const [showAllPayments, setShowAllPayments] = useState(false);
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
  const people = `/group/${groupId}/members`;
  const requests = view.entries
    .filter((e) => e.kind === 'pool_request' && !e.deleted)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  const payments = view.entries.filter(
    (e) =>
      e.kind === 'wage_payment' ||
      e.kind === 'wages' ||
      e.kind === 'advance' ||
      e.kind === 'reimbursement',
  );
  const noBudgets = managers.length === 0 && sites.length === 0 && requests.length === 0;

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

  const month = todayIso().slice(0, 7);
  const monthBudget = (managerId: string): bigint => {
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
                limit={showAllRecent ? 200 : 4}
                header={{
                  title: t.company.recentTitle,
                  // Expand in place: the payments tab hides expenses and allowances.
                  onViewAll: showAllRecent ? undefined : () => setShowAllRecent(true),
                }}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.company.addSite}
                onPress={addSite.open}
              >
                <StandardCard
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.brandSoft,
                    }}
                  >
                    <Ionicons name="location" size={iconSize.lg} color={theme.color.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ fontWeight: '700' }}>
                      {t.company.addSite}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {t.company.addSiteBody}
                    </Text>
                  </View>
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.sm}
                    color={theme.color.textFaint}
                  />
                </StandardCard>
              </Pressable>
              {noBudgets ? (
                <View style={{ alignItems: 'center', gap: 8, paddingTop: 8 }}>
                  <BudgetArt />
                  <Text variant="heading" align="center">
                    {t.company.budgetsNone}
                  </Text>
                  <Text variant="caption" tone="muted" align="center">
                    {t.company.budgetsNoneBody}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    {(
                      [
                        ['people-outline', theme.color.brandSoft, theme.color.brand, 'setBudget'],
                        ['git-network-outline', BLUE_SOFT, BLUE, 'assignManager'],
                        ['bar-chart', GREEN_SOFT, GREEN, 'trackSpending'],
                      ] as const
                    ).map(([icon, bg, fg, key]) => (
                      <View key={key} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                        <View
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 23,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: bg,
                          }}
                        >
                          <Ionicons name={icon} size={iconSize.lg} color={fg} />
                        </View>
                        <Text variant="caption" align="center" style={{ fontWeight: '700' }}>
                          {t.company[key]}
                        </Text>
                        <Text
                          variant="caption"
                          tone="muted"
                          align="center"
                          style={{ fontSize: 11.5 }}
                        >
                          {t.company[`${key}Body` as const]}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.company.addSite}
                    onPress={addSite.open}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      height: 44,
                      paddingHorizontal: 28,
                      marginTop: 8,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.color.buttonPrimary,
                    }}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={iconSize.md}
                      color={theme.color.onButtonPrimary}
                    />
                    <Text style={{ fontWeight: '600', color: theme.color.onButtonPrimary }}>
                      {t.company.addSite}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <OwnerCashList groupId={groupId} view={view} />
                  {requests.length > 0 ? (
                    <>
                      <Text variant="title">{t.company.budgetRequests}</Text>
                      <StandardCard>
                        {requests.map((r, i) => {
                          const m = live.find((x) => x.id === r.memberId);
                          return (
                            <ListRow
                              key={r.id}
                              title={
                                m ? displayName(m, null, null, t.misc.someone) : t.misc.someone
                              }
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
                </>
              )}
            </>
          ) : null}

          {tab === 'payments' ? (
            <>
              <StandardCard style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
                <Text variant="title" style={{ fontSize: 16 }}>
                  {t.company.recordPayment}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.company.recordPaymentBody}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <ActionTile
                    icon="cash-outline"
                    title={t.company.payWages}
                    body={t.company.payWagesBody}
                    tone="violet"
                    onPress={() => router.push(`/group/${groupId}/company-wages`)}
                  />
                  <ActionTile
                    icon="arrow-up-circle-outline"
                    title={t.company.gaveMoney}
                    body={t.company.gaveMoneyBody}
                    tone="blue"
                    onPress={() => router.push(`/group/${groupId}/company-entry?kind=advance`)}
                  />
                </View>
              </StandardCard>
              <RecentActivity
                groupId={groupId}
                view={view}
                entries={payments}
                limit={showAllPayments ? payments.length : 5}
                header={{
                  title: t.company.recentPayments,
                  icon: false,
                  onViewAll:
                    !showAllPayments && payments.length > 5
                      ? () => setShowAllPayments(true)
                      : undefined,
                }}
                empty={
                  <View style={{ alignItems: 'center', gap: 2, paddingVertical: 4 }}>
                    <ReceiptArt />
                    <Text variant="body" style={{ fontWeight: '700' }}>
                      {t.company.paymentsNone}
                    </Text>
                    <Text variant="caption" tone="muted" align="center">
                      {t.company.paymentsNoneBody}
                    </Text>
                  </View>
                }
              />
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
