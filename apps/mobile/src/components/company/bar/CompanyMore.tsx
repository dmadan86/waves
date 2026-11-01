import { useState, type ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { Text, directionalIcon, useTheme } from '@waves/ui';

import { DepartmentSheet } from '@/components/company/DepartmentSheet';
import { CompanyRules } from '@/components/company/CompanyRules';
import { useMoney } from '@/components/company/dashboard/parts';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { SectionHeader, StandardCard } from '@/components/standard';
import { useClientMoney, useCompanyClients, useFollowUps } from '@/data/companyClients';
import { useUnpaidBills } from '@/data/companyDocuments';
import { useCompanyEntries } from '@/data/companyEntries';
import { useCompanyVendors } from '@/data/companyVendors';
import { useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { fill, useStrings } from '@/i18n';
import { usePendingCount } from '@/lib/companyPending';
import { router } from '@/lib/navigation';

type IconName = ComponentProps<typeof Ionicons>['name'];
interface Tile {
  readonly name: string;
  readonly icon: IconName;
  /** A count for things needing action (red) or a running total (violet). */
  readonly badge?: { n: number; red?: boolean };
  readonly sub?: string;
  readonly onPress: () => void;
}
const GAP = 8;
const PAD = 12;
const ring = (d: number) => ({
  width: d,
  height: d,
  borderRadius: d / 2,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
});

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
  const tileW = (width - 2 * theme.spacing.lg - 2 * PAD - 2 * GAP) / 3;
  const go = (route: string) => () => router.push(`/group/${groupId}/${route}`);
  const owed = [...vendors.balances.values()].reduce((a, b) => (b > 0n ? a + b : a), 0n);
  const due = followUps.dueToday + followUps.overdue;
  const openTasks = tasks.filter((x) => x.status !== 'done').length;
  const live = view.members.filter((m) => !m.left_at && m.role === 'member').length;

  const groups: {
    label: string;
    sub: string;
    icon: IconName;
    ink: string;
    soft: string;
    tiles: Tile[];
  }[] = [
    {
      label: h.hubMoneyIn,
      sub: h.hubInSub,
      icon: 'arrow-down',
      ink: theme.color.positive,
      soft: theme.color.positiveSoft,
      tiles: [
        ...(clients.canAdd
          ? [
              {
                name: h.title,
                icon: 'people-outline',
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
                icon: 'checkbox-outline',
                sub: due ? fill(h.hubDue, { n: due }) : h.hubNothing,
                onPress: go('company-followups'),
              },
            ]
          : []),
        ...(view.isAdmin
          ? [
              {
                name: t.companyDocs.title,
                icon: 'document-text-outline',
                sub: unpaid.count ? fill(h.hubOpen, { n: unpaid.count }) : undefined,
                onPress: go('company-bills'),
              },
            ]
          : []),
      ],
    },
    {
      label: h.hubMoneyOut,
      sub: h.hubOutSub,
      icon: 'arrow-up',
      ink: theme.color.negative,
      soft: theme.color.negativeSoft,
      tiles: [
        ...(vendors.canManage
          ? [
              {
                name: t.companyVendors.title,
                icon: 'storefront-outline',
                sub: owed > 0n ? fill(h.hubToPay, { amount: fmt(owed) }) : undefined,
                onPress: go('company-vendors'),
              },
            ]
          : []),
        ...(view.isAdmin
          ? [
              {
                name: t.company.barPending,
                icon: 'document-attach-outline',
                badge: pending ? { n: pending, red: true } : undefined,
                sub: pending ? fill(h.hubToApprove, { n: pending }) : undefined,
                onPress: go('company-pending'),
              },
              {
                name: t.company.tabPayments,
                icon: 'card-outline',
                onPress: go('company-payments'),
              },
            ]
          : []),
      ],
    },
    {
      label: h.hubTeam,
      sub: h.hubTeamSub,
      icon: 'people-outline',
      ink: theme.color.brand,
      soft: theme.color.brandSoft,
      tiles: [
        ...(view.isAdmin
          ? [
              {
                name: t.company.barPeople,
                icon: 'person-outline',
                sub: live ? fill(h.hubPeople, { n: live }) : undefined,
                onPress: go('company-people'),
              },
            ]
          : []),
        ...(access.enabled
          ? [
              {
                name: t.company.attendanceTitle,
                icon: 'calendar-outline',
                onPress: go('company-attendance'),
              },
              {
                name: t.company.teamTabTasks,
                icon: 'checkbox-outline',
                badge: openTasks ? { n: openTasks } : undefined,
                sub: openTasks ? fill(h.hubOpen, { n: openTasks }) : undefined,
                onPress: go('company-work'),
              },
            ]
          : []),
        {
          name: t.calendar.title,
          icon: 'calendar-number-outline',
          onPress: go('company-calendar'),
        },
        ...(view.isOwner
          ? [
              {
                name: t.company.departments,
                icon: 'layers-outline',
                onPress: () => setDepartmentsOpen(true),
              },
            ]
          : []),
      ],
    },
    {
      label: h.hubBooks,
      sub: h.hubBooksSub,
      icon: 'book-outline',
      ink: theme.color.brand,
      soft: theme.color.brandSoft,
      tiles: [
        {
          name: t.company.moreStatements,
          icon: 'stats-chart-outline',
          sub: h.hubFiles,
          onPress: () => router.push(`/group/${groupId}/export`),
        },
        ...(vendors.canManage
          ? [
              {
                name: t.companyDetails.title,
                icon: 'business-outline',
                onPress: go('company-details'),
              },
            ]
          : []),
        ...(view.isOwner
          ? [
              {
                name: t.company.moreBudgets,
                icon: 'pie-chart-outline',
                onPress: go('company-budgets'),
              },
              {
                name: t.companyStorage.title,
                icon: 'cloud-outline',
                onPress: go('company-storage'),
              },
            ]
          : []),
      ],
    },
  ].filter((g) => g.tiles.length > 0);

  return (
    <SectionShell groupId={groupId} view={view}>
      <View style={{ gap: theme.spacing.md }}>
        {groups.map((g) => (
          <StandardCard key={g.label} style={{ padding: PAD, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[ring(40), { backgroundColor: g.soft }]}>
                <Ionicons name={g.icon} size={22} color={g.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="title" accessibilityRole="header" style={{ fontSize: 17 }}>
                  {g.label}
                </Text>
                <Text variant="caption" tone="muted">
                  {g.sub}
                </Text>
              </View>
            </View>
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
                      minHeight: 84,
                      borderRadius: theme.radius.lg,
                      backgroundColor: theme.color.surface,
                      gap: 4,
                      padding: 8,
                      opacity: pressed ? 0.7 : 1,
                    },
                    theme.shadow.soft,
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[ring(28), { backgroundColor: theme.color.brandSoft }]}>
                      <Ionicons name={tile.icon} size={16} color={theme.color.brand} />
                    </View>
                    <View style={{ flex: 1 }} />
                    {tile.badge ? (
                      <View
                        style={{
                          minWidth: 20,
                          height: 20,
                          borderRadius: 10,
                          paddingHorizontal: 5,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: tile.badge.red
                            ? theme.color.negative
                            : theme.color.brand,
                        }}
                      >
                        <Text variant="micro" style={{ color: '#fff', fontWeight: '800' }}>
                          {tile.badge.n}
                        </Text>
                      </View>
                    ) : (
                      <Ionicons
                        name={directionalIcon('chevron-forward')}
                        size={14}
                        color={theme.color.textMuted}
                      />
                    )}
                  </View>
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
          </StandardCard>
        ))}
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
