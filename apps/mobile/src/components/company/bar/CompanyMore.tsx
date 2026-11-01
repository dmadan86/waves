import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { DepartmentSheet } from '@/components/company/DepartmentSheet';
import { CompanyRules } from '@/components/company/CompanyRules';
import { useMoney } from '@/components/company/dashboard/parts';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { useClientMoney, useCompanyClients, useFollowUps } from '@/data/companyClients';
import { useUnpaidBills } from '@/data/companyDocuments';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { fill, useStrings } from '@/i18n';
import { usePendingCount } from '@/lib/companyPending';
import { router } from '@/lib/navigation';

interface Tile {
  readonly name: string;
  readonly sub?: string;
  readonly onPress: () => void;
}
const GAP = 8;

/** The company menu: everything the bar does not carry, in four groups (Money in, Money out, Team, Books). */
export function CompanyMore({ groupId }: { groupId: string }) {
  const view = useCompanyEntries(groupId);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const vendors = useCompanyVendors(groupId);
  const clients = useCompanyClients(groupId);
  const clientMoney = useClientMoney(groupId);
  const followUps = useFollowUps(groupId);
  const unpaid = useUnpaidBills(groupId);
  const pending = usePendingCount(groupId);
  const access = useWorkdayAccess(groupId);
  const tasks = useWorkTasks(groupId);
  const fmt = useMoney(view.currency);
  const { t } = useStrings();
  const h = t.companyClients;
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const tileW = (width - 2 * theme.spacing.lg - 2 * GAP) / 3;
  const go = (route: string) => () => router.push(`/group/${groupId}/${route}`);
  const owed = [...vendors.balances.values()].reduce((a, b) => (b > 0n ? a + b : a), 0n);
  const due = followUps.dueToday + followUps.overdue;
  const openTasks = tasks.filter((x) => x.status !== 'done').length;
  const live = view.members.filter((m) => !m.left_at && m.role === 'member').length;

  const groups: { label: string; ink: string; tiles: Tile[] }[] = [
    {
      label: h.hubMoneyIn,
      ink: theme.color.positive,
      tiles: [
        ...(clients.canAdd
          ? [
              {
                name: h.title,
                sub:
                  clientMoney.total > 0n
                    ? fill(h.hubToReceive, { amount: fmt(clientMoney.total) })
                    : fill(h.hubOpen, {
                        n: clients.clients.filter((c) => c.stage !== 'lost').length,
                      }),
                onPress: go('company-clients'),
              },
              {
                name: h.fuTitle,
                sub: due ? fill(h.hubToday, { n: due }) : h.hubNothing,
                onPress: go('company-followups'),
              },
            ]
          : []),
        ...(view.isAdmin
          ? [
              {
                name: t.companyDocs.title,
                sub: unpaid.count ? fill(h.hubOpen, { n: unpaid.count }) : undefined,
                onPress: go('company-bills'),
              },
            ]
          : []),
      ],
    },
    {
      label: h.hubMoneyOut,
      ink: theme.color.negative,
      tiles: [
        ...(vendors.canManage
          ? [
              {
                name: t.companyVendors.title,
                sub: owed > 0n ? fill(h.hubToPay, { amount: fmt(owed) }) : undefined,
                onPress: go('company-vendors'),
              },
            ]
          : []),
        ...(view.isAdmin
          ? [
              {
                name: t.company.barPending,
                sub: pending ? fill(h.hubToApprove, { n: pending }) : undefined,
                onPress: go('company-pending'),
              },
              { name: t.company.tabPayments, onPress: go('company-payments') },
            ]
          : []),
      ],
    },
    {
      label: h.hubTeam,
      ink: theme.color.brand,
      tiles: [
        ...(view.isAdmin
          ? [
              {
                name: t.company.barPeople,
                sub: live ? fill(h.hubPeople, { n: live }) : undefined,
                onPress: go('company-people'),
              },
            ]
          : []),
        ...(access.enabled
          ? [
              { name: t.company.attendanceTitle, onPress: go('company-attendance') },
              {
                name: t.company.teamTabTasks,
                sub: openTasks ? fill(h.hubOpen, { n: openTasks }) : undefined,
                onPress: go('company-work'),
              },
            ]
          : []),
        { name: t.calendar.title, onPress: go('company-calendar') },
        ...(view.isOwner
          ? [{ name: t.company.departments, onPress: () => setDepartmentsOpen(true) }]
          : []),
      ],
    },
    {
      label: h.hubBooks,
      ink: theme.color.textMuted,
      tiles: [
        {
          name: t.company.moreStatements,
          sub: h.hubFiles,
          onPress: () => router.push(`/group/${groupId}/export`),
        },
        ...(vendors.canManage
          ? [{ name: t.companyDetails.title, onPress: go('company-details') }]
          : []),
        ...(view.isOwner
          ? [
              { name: t.company.moreBudgets, onPress: go('company-budgets') },
              { name: t.companyStorage.title, onPress: go('company-storage') },
            ]
          : []),
      ],
    },
  ].filter((g) => g.tiles.length > 0);

  return (
    <SectionShell groupId={groupId} view={view}>
      <View style={{ gap: theme.spacing.md }}>
        {groups.map((g) => (
          <View key={g.label} style={{ gap: 6 }}>
            <Text variant="micro" style={{ color: g.ink, fontWeight: '800', letterSpacing: 0.4 }}>
              {g.label.toUpperCase()}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
              {g.tiles.map((tile) => (
                <Pressable
                  key={tile.name}
                  accessibilityRole="button"
                  accessibilityLabel={[tile.name, tile.sub].filter(Boolean).join(', ')}
                  onPress={tile.onPress}
                  style={({ pressed }) => [
                    {
                      width: tileW,
                      minHeight: 78,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.color.surface,
                      justifyContent: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      opacity: pressed ? 0.7 : 1,
                    },
                    theme.shadow.soft,
                  ]}
                >
                  <Text variant="caption" numberOfLines={2} style={{ fontWeight: '700' }}>
                    {tile.name}
                  </Text>
                  {tile.sub ? (
                    <Text variant="micro" tone="muted" numberOfLines={1}>
                      {tile.sub}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <StandardCard>
          <ListRow
            leading={
              <Ionicons name="swap-horizontal-outline" size={22} color={theme.color.textMuted} />
            }
            title={t.company.switchCompany}
            onPress={() => router.push('/companies')}
          />
        </StandardCard>
        {view.isOwner ? (
          <>
            <SectionHeader title={t.company.moreRules} />
            <CompanyRules groupId={groupId} view={view} />
          </>
        ) : null}
      </View>
      {view.isOwner ? (
        <DepartmentSheet
          groupId={groupId}
          visible={departmentsOpen}
          onClose={() => setDepartmentsOpen(false)}
          manageOnly
        />
      ) : null}
    </SectionShell>
  );
}
