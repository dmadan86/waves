/**
 * A manager's company Overview: their team only. Budget card (allocated, given out, left),
 * the team's stats, quick actions and the team list. Server rules already hide every
 * other team; nothing here is company-wide.
 */

import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { dashboardStats, poolBalance } from '@waves/core';
import { AmountField, Button, Row, Sheet, Text, useTheme } from '@waves/ui';
import type { CurrencyCode } from '@waves/core';

import { QuickActions, StatTriple, TitleRow, useMoney } from '@/components/company/dashboard/parts';
import { RecentCompanyActivity } from '@/components/company/CompanyActivityFeed';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { LayoutEditor, OverviewCards } from '@/components/company/dashboard/OverviewGrid';
import { OverviewTop } from '@/components/company/dashboard/OverviewTop';
import { WorkdayTiles } from '@/components/company/WorkdayEntries';
import { OverviewUpcoming } from '@/components/company/dashboard/OverviewUpcoming';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, StandardCard } from '@/components/standard';
import { useAskBudget, useCompanyEntries, usePoolBalance } from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import { useOverviewLayout } from '@/lib/overviewLayoutStore';

export function ManagerHome({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const view = useCompanyEntries(groupId);
  const fmt = useMoney(view.currency);
  const ask = useAskBudget(groupId);
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState(0n);
  const { layout, save, reset } = useOverviewLayout(groupId, 'manager');
  const [editing, setEditing] = useState(false);

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
  const given = pool ? pool.advances + pool.reimbursed + pool.wages + pool.companySpend : 0n;
  const budget = pool ? pool.allocated + pool.adjusted - pool.returned : 0n;
  const ratio = budget > 0n ? Math.min(1, Number((given * 1000n) / budget) / 1000) : 0;
  const thread = (id: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${id}`);

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
          role="manager"
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
                  upcoming: <OverviewUpcoming groupId={groupId} />,
                  budget: (
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
                      {pool && pool.companySpend !== 0n ? (
                        <Text variant="caption" tone="muted">
                          {t.company.companyPayer}: {fmt(pool.companySpend)}
                        </Text>
                      ) : null}
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
                  ),
                  stats: (
                    <StatTriple
                      stats={stats}
                      currency={view.currency}
                      onOwes={() => router.replace(`/group/${groupId}/company-people`)}
                    />
                  ),
                  quick: (
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
                        {
                          icon: 'arrow-up-circle-outline',
                          label: t.company.qaAdvance,
                          onPress: () =>
                            router.push(`/group/${groupId}/company-entry?kind=advance`),
                        },
                      ]}
                    />
                  ),
                  workday: <WorkdayTiles groupId={groupId} />,
                  team: (
                    <>
                      <TitleRow
                        title={t.company.tabMyTeam}
                        onViewAll={() => router.replace(`/group/${groupId}/company-people`)}
                      />
                      <StandardCard>
                        {team.slice(0, 4).map((m, i, all) => (
                          <ListRow
                            key={m.id}
                            leading={
                              <PersonAvatar
                                member={m}
                                name={displayName(m)}
                                ghost={isGhost(m)}
                                size={40}
                              />
                            }
                            title={displayName(m, null, null, t.misc.someone)}
                            subtitle={m.employee_id || undefined}
                            onPress={() => thread(m.id)}
                            divider={i < all.length - 1}
                          />
                        ))}
                      </StandardCard>
                    </>
                  ),
                  activity: <RecentCompanyActivity groupId={groupId} />,
                }}
              />
              {own.sheet}
            </>
          )}
        />
      )}
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
    </SectionShell>
  );
}
