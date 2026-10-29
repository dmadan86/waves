/**
 * A manager's company home: their team only. Budget card (allocated, given out, left),
 * the team's stats, quick actions and the team list. Server rules already hide every
 * other team; nothing here is company-wide.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import { dashboardStats, poolBalance } from '@waves/core';
import { AmountField, Button, Row, Screen, Sheet, Text, iconSize, useTheme } from '@waves/ui';
import type { CurrencyCode } from '@waves/core';

import {
  DashBody,
  DashHeader,
  TabPills,
  QuickActions,
  RecentActivity,
  StatTriple,
  TitleRow,
  useMoney,
} from '@/components/company/dashboard/parts';
import { PendingApprovals } from '@/components/company/dashboard/PendingApprovals';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, StandardCard } from '@/components/standard';
import { useAskBudget, useCompanyEntries, usePoolBalance } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

type Tab = 'overview' | 'team' | 'payments';

export function ManagerHome({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const fmt = useMoney(view.currency);
  const ask = useAskBudget(groupId);
  const [tab, setTab] = useState<Tab>('overview');
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState(0n);

  const me = view.me;
  const team = view.members.filter((m) => !m.left_at && m.id !== me?.id && m.role === 'member');
  const left = usePoolBalance(groupId, me?.id ?? null);
  const pool = useMemo(() => (me ? poolBalance(view.entries, me.id) : null), [view.entries, me]);
  const stats = useMemo(
    () =>
      dashboardStats(
        view.entries,
        team.map((m) => m.id),
        todayIso(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.entries, view.members],
  );
  const given = pool ? pool.advances + pool.reimbursed + pool.wages : 0n;
  const budget = pool ? pool.allocated + pool.adjusted - pool.returned : 0n;
  const ratio = budget > 0n ? Math.min(1, Number((given * 1000n) / budget) / 1000) : 0;
  const thread = (id: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${id}`);

  const teamIds = new Set(team.map((m) => m.id));
  const teamEntries = view.entries.filter((e) => teamIds.has(e.memberId));

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <DashHeader
          groupId={groupId}
          view={view}
          showGear={false}
          subtitle={fill(t.company.teamLine, {
            employees: plural(locale, team.length, t.company.employeeCount),
          })}
          pill={t.company.manager}
          tabs={
            <TabPills
              options={[
                { value: 'overview' as Tab, label: t.company.tabOverview },
                { value: 'team' as Tab, label: t.company.tabMyTeam },
                { value: 'payments' as Tab, label: t.company.tabPayments },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
        />
        <DashBody>
          {tab === 'overview' ? (
            <>
              <PendingApprovals groupId={groupId} view={view} />
              <StandardCard style={{ gap: theme.spacing.sm }}>
                <Text variant="caption" tone="muted">
                  {t.company.yourBudget}
                </Text>
                <Text variant="title">{fmt(budget)}</Text>
                <View
                  accessibilityLabel={`${Math.round(ratio * 100)}%`}
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.color.surfaceMuted,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      height: 8,
                      width: `${Math.round(ratio * 100)}%`,
                      backgroundColor: theme.color.brand,
                    }}
                  />
                </View>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="caption">
                    {t.company.givenOut}: {fmt(given)}
                  </Text>
                  <Text variant="caption">
                    {t.company.budgetLeft}: {fmt(left ?? 0n)}
                  </Text>
                </Row>
                {pool && (pool.returned !== 0n || pool.adjusted !== 0n) ? (
                  <Text variant="micro" tone="muted">
                    {fill(t.company.budgetAdjusted, {
                      amount: fmt(
                        pool.returned + (pool.adjusted < 0n ? -pool.adjusted : pool.adjusted),
                      ),
                    })}
                  </Text>
                ) : null}
              </StandardCard>
              <StatTriple stats={stats} currency={view.currency} onOwes={() => setTab('team')} />
              <QuickActions
                actions={[
                  {
                    icon: 'person-add-outline',
                    label: t.company.qaAddEmployee,
                    onPress: () => router.push(`/group/${groupId}/members`),
                  },
                  {
                    icon: 'paper-plane-outline',
                    label: t.company.qaRecord,
                    onPress: () => router.push(`/group/${groupId}/company-wages`),
                  },
                  {
                    icon: 'arrow-up-circle-outline',
                    label: t.company.qaAdvance,
                    onPress: () => router.push(`/group/${groupId}/company-entry?kind=advance`),
                  },
                  {
                    icon: 'chatbubble-ellipses-outline',
                    label: t.company.qaAsk,
                    onPress: () => setAsking(true),
                  },
                ]}
              />
              <TitleRow title={t.company.tabMyTeam} onViewAll={() => setTab('team')} />
              <StandardCard>
                {team.slice(0, 4).map((m, i, all) => (
                  <ListRow
                    key={m.id}
                    leading={
                      <PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={40} />
                    }
                    title={displayName(m, null, null, t.misc.someone)}
                    onPress={() => thread(m.id)}
                    divider={i < all.length - 1}
                  />
                ))}
              </StandardCard>
              <TitleRow title={t.company.recentTitle} onViewAll={() => setTab('payments')} />
              <RecentActivity groupId={groupId} view={view} entries={teamEntries} limit={4} />
            </>
          ) : null}
          {tab === 'team' ? (
            <StandardCard>
              {team.map((m, i) => (
                <ListRow
                  key={m.id}
                  leading={
                    <PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={40} />
                  }
                  title={displayName(m, null, null, t.misc.someone)}
                  onPress={() => thread(m.id)}
                  divider
                />
              ))}
              <ListRow
                title={t.company.qaAddEmployee}
                leading={
                  <Ionicons
                    name="person-add-outline"
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                }
                onPress={() => router.push(`/group/${groupId}/members`)}
              />
            </StandardCard>
          ) : null}
          {tab === 'payments' ? (
            <RecentActivity groupId={groupId} view={view} entries={teamEntries} />
          ) : null}
        </DashBody>
      </ScrollView>
      <Sheet visible={asking} onClose={() => setAsking(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.lg }}>
          <Text variant="title">{t.company.askTitle}</Text>
          <AmountField
            currency={view.currency as CurrencyCode}
            value={amount}
            onChange={setAmount}
            size="compact"
          />
          <Button
            label={t.company.askTitle}
            disabled={amount <= 0n || ask.isPending || !me}
            onPress={() => {
              if (!me) return;
              ask.mutate(
                { managerId: me.id, amountMinor: amount.toString(), note: null, today: todayIso() },
                {
                  onSuccess: () => {
                    setAmount(0n);
                    setAsking(false);
                  },
                },
              );
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
