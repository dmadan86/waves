/**
 * People: Employees / Managers / Owners / Not employed. An owner sees all four; a manager sees only
 * their own team (Employees / Not employed). Every per-person number (today's mark, open tasks,
 * balance) is computed once per render into a map, never per row.
 * shortcut: no "salary due in N days" and no "On leave" (no pay-day or leave data exists yet).
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { ManagerTeamArt } from '@/components/company/dashboard/art';
import {
  BLUE,
  BLUE_SOFT,
  GREEN,
  GREEN_SOFT,
  RolePill,
  TabPills,
  useMoney,
} from '@/components/company/dashboard/parts';
import { EmployeeRow } from '@/components/company/dashboard/EmployeeRow';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, SectionHeader, StandardCard } from '@/components/standard';
import { CompanyEmploymentControl } from '@/components/company/CompanyEmploymentControl';
import {
  EmploymentTypeSheet,
  useEmploymentTypeLabel,
} from '@/components/company/EmploymentTypeSheet';
import { useCompanyEntries } from '@/data/companyEntries';
import { useActiveToday } from '@/data/companyOverview';
import { departmentName, useDepartments } from '@/data/companyDepartments';
import {
  attendanceToday,
  balanceLabel,
  balancesByMember,
  canSetEmploymentType,
  managerBalances,
  monthlyBudgets,
  openTasksToday,
  peopleTabCounts,
  type Balance,
} from '@/data/companyPeople';
import { useAttendance, useWorkTasks } from '@/data/companyWorkday';
import { useSetMemberRole } from '@/data/hooks';
import { canSetEmployment, employmentPeople, isNotEmployed } from '@/data/companyEmployment';
import { todayIso } from '@/data/personal';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

type Tab = 'employees' | 'managers' | 'owners' | 'notEmployed';
type MarkFilter = 'all' | 'present' | 'half' | 'absent' | 'unmarked';
type BalanceFilter = 'all' | 'owesCompany' | 'companyOwes' | 'settled';

const SETTLED: Balance = { kind: 'settled', amount: 0n };

export function CompanyPeople({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const params = useLocalSearchParams<{ filter?: string }>();
  const activeToday = params.filter === 'activeToday';
  const active = useActiveToday(groupId);
  const departments = useDepartments(groupId);
  const typeLabel = useEmploymentTypeLabel();
  const fmt = useMoney(view.currency);
  const role = useSetMemberRole(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  const [tab, setTab] = useState<Tab>('employees');
  const [promoting, setPromoting] = useState(false);
  const [query, setQuery] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [employmentMember, setEmploymentMember] = useState<MemberRow | null>(null);
  const [typeMember, setTypeMember] = useState<MemberRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>('all');
  const [markFilter, setMarkFilter] = useState<MarkFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [managerFilter, setManagerFilter] = useState<string | null>(null);

  const today = todayIso();
  const live = view.members.filter((m) => !m.left_at);
  const owners = live.filter((m) => m.role === 'admin');
  const managers = live.filter((m) => m.role === 'manager');
  // A manager's server-side view already holds only their team; never list themself.
  const employeeRows = view.members.filter(
    (m) => (m.role === 'member' || (m.role === 'manager' && !!m.left_at)) && m.id !== view.me?.id,
  );
  const employees = employmentPeople(employeeRows, false);
  const former = employmentPeople(employeeRows, true);
  const teamOf = (managerId: string): MemberRow[] =>
    employees.filter((m) => m.manager_id === managerId);

  // Maps built once; rows only look up.
  const balances = useMemo(
    () =>
      balancesByMember(
        view.entries,
        employeeRows.map((m) => m.id),
        today,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- members change identity every render; ids are what matter
    [view.entries, view.members, today],
  );
  const poolBalances = useMemo(
    () =>
      managerBalances(
        view.entries,
        managers.map((m) => m.id),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids are what matter
    [view.entries, view.members],
  );
  const tasks = useMemo(() => openTasksToday(allTasks, today), [allTasks, today]);
  const budgets = useMemo(
    () => monthlyBudgets(view.entries, today.slice(0, 7)),
    [view.entries, today],
  );
  const balanceOf = (id: string): Balance => balances.get(id) ?? SETTLED;

  const thread = (memberId: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${memberId}`);
  const people = `/group/${groupId}/members`;
  const q = query.trim().toLowerCase();
  const matches = (m: MemberRow): boolean =>
    !q || displayName(m, null, null, t.misc.someone).toLowerCase().includes(q);
  const anyFilter =
    balanceFilter !== 'all' || markFilter !== 'all' || !!departmentFilter || !!managerFilter;

  const shown = (tab === 'notEmployed' ? former : employees).filter(
    (m) =>
      matches(m) &&
      (balanceFilter === 'all' || balanceOf(m.id).kind === balanceFilter) &&
      (!departmentFilter || m.department_id === departmentFilter) &&
      (!managerFilter || m.manager_id === managerFilter) &&
      (markFilter === 'all' ||
        (attendanceToday(marks, m.id, today) ?? 'unmarked') === markFilter) &&
      (tab === 'notEmployed' || !activeToday || !!active?.activeIds.has(m.id)),
  );
  const shownManagers = managers.filter(matches);

  const amountText = (b: Balance): string => balanceLabel(b, t.company.settled, fmt);
  const taskText = (id: string): string | undefined => {
    const n = tasks.get(id) ?? 0;
    return n ? plural(locale, n, t.company.tasksCount) : undefined;
  };
  const menuFor = (m: MemberRow) => [
    {
      icon: 'document-text-outline' as const,
      label: t.company.viewStatement,
      onPress: () => thread(m.id),
    },
    ...(canSetEmploymentType(view.me, m, view.suspended)
      ? [
          {
            icon: 'briefcase-outline' as const,
            label: t.company.employmentType,
            onPress: () => setTypeMember(m),
          },
        ]
      : []),
    ...(canSetEmployment(view.me, m, view.suspended)
      ? [
          {
            icon: isNotEmployed(m)
              ? ('checkmark-circle-outline' as const)
              : ('person-remove-outline' as const),
            label: isNotEmployed(m) ? t.company.markEmployed : t.company.markNotEmployed,
            onPress: () => setEmploymentMember(m),
          },
        ]
      : []),
  ];
  const rowFor = (m: MemberRow, divider: boolean, compact = false) => {
    const gone = isNotEmployed(m);
    const balance = balanceOf(m.id);
    return (
      <EmployeeRow
        key={m.id}
        member={m}
        name={displayName(m, null, null, t.misc.someone)}
        ghost={isGhost(m)}
        subtitle={
          [typeLabel(m.employment_type), departmentName(departments, m.department_id)]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        attendance={gone ? null : attendanceToday(marks, m.id, today)}
        tasks={gone ? undefined : taskText(m.id)}
        balance={balance}
        balanceText={amountText(balance)}
        employeeId={m.employee_id}
        note={gone && m.employment_ended_on ? showDate(m.employment_ended_on, locale) : undefined}
        muted={gone}
        compact={compact}
        menuLabel={t.company.employeeOptions}
        menuItems={menuFor(m)}
        onPress={() => thread(m.id)}
        divider={divider}
      />
    );
  };

  const counts = peopleTabCounts({
    employees: employees.length,
    managers: managers.length,
    owners: owners.length,
    former: former.length,
  });
  const tabs: { value: Tab; label: string; count?: number }[] = view.isOwner
    ? [
        { value: 'employees', label: t.company.tabEmployees, count: counts.employees },
        { value: 'managers', label: t.company.tabManagers, count: counts.managers },
        { value: 'owners', label: t.company.sectionOwners, count: counts.owners },
        { value: 'notEmployed', label: t.company.notEmployed, count: counts.notEmployed },
      ]
    : [
        { value: 'employees', label: t.company.tabMyTeam, count: counts.employees },
        { value: 'notEmployed', label: t.company.notEmployed, count: counts.notEmployed },
      ];

  const searchRow = (placeholder: string, withFilter: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          height: 44,
          paddingHorizontal: 14,
          gap: 8,
          borderRadius: theme.radius.pill,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
        }}
      >
        <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={theme.color.textFaint}
          accessibilityLabel={placeholder}
          style={{
            flex: 1,
            paddingVertical: 0,
            fontSize: theme.typography.body.fontSize,
            color: theme.color.text,
          }}
        />
      </View>
      {withFilter ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.filterEmployees}
          onPress={() => setFiltering(true)}
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.pill,
            backgroundColor: anyFilter ? theme.color.brand : theme.color.brandSoft,
          }}
        >
          <Ionicons
            name="options-outline"
            size={iconSize.md}
            color={anyFilter ? theme.color.onBrand : theme.color.brand}
          />
        </Pressable>
      ) : null}
    </View>
  );

  const ownerCard = (
    <StandardCard>
      {owners.map((m, i) => (
        <ListRow
          key={m.id}
          leading={<PersonAvatar member={m} name={displayName(m)} size={40} />}
          title={displayName(m, null, null, t.misc.someone)}
          subtitle={t.company.companyOwnerLine}
          trailing={<RolePill label={t.company.pillOwner} />}
          divider={i < owners.length - 1}
        />
      ))}
    </StandardCard>
  );

  const managerCard = (m: MemberRow) => {
    const team = teamOf(m.id);
    const open = expanded === m.id;
    const balance = poolBalances.get(m.id) ?? SETTLED;
    const budget = budgets.get(m.id) ?? 0n;
    const teamTasks = team.reduce((sum, e) => sum + (tasks.get(e.id) ?? 0), 0);
    const balanceColor =
      balance.kind === 'owesCompany' ? theme.color.negative : theme.color.positive;
    const stat = (icon: keyof typeof Ionicons.glyphMap, value: string, label: string) => (
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
        <View style={{ flexShrink: 1 }}>
          <Text variant="body" style={{ fontWeight: '700' }} numberOfLines={1}>
            {value}
          </Text>
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
    );
    return (
      <StandardCard key={m.id} style={{ gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => (team.length ? setExpanded(open ? null : m.id) : thread(m.id))}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={40} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="body" numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
                {displayName(m, null, null, t.misc.someone)}
              </Text>
              <RolePill label={t.company.manager} />
            </View>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {budget > 0n
                ? fill(t.company.budgetPerMonth, { amount: fmt(budget) })
                : t.company.noBudgetSet}
            </Text>
          </View>
          {team.length ? (
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={iconSize.md}
              color={theme.color.textMuted}
            />
          ) : null}
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {stat('people-outline', String(team.length), t.company.tabEmployees)}
          {stat('checkbox-outline', String(teamTasks), t.company.overviewTasks)}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.company.viewStatement}
            onPress={() => thread(m.id)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons
              name={balance.kind === 'companyOwes' ? 'arrow-down' : 'arrow-up'}
              size={iconSize.md}
              color={balanceColor}
            />
            <View style={{ flexShrink: 1 }}>
              <Text
                variant="body"
                style={{ fontWeight: '700', color: balanceColor }}
                numberOfLines={1}
              >
                {amountText(balance)}
              </Text>
              {balance.kind === 'settled' ? null : (
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {balance.kind === 'owesCompany' ? t.company.owesToCompany : t.company.weOwe}
                </Text>
              )}
            </View>
          </Pressable>
        </View>
        {open ? (
          <View
            style={{
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.surfaceMuted,
              paddingHorizontal: 10,
            }}
          >
            {team.map((e, i) => rowFor(e, i < team.length - 1, true))}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setManagerFilter(m.id);
                setTab('employees');
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 12,
              }}
            >
              <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                {fill(t.company.viewAllEmployees, { n: String(team.length) })}
              </Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.brand} />
            </Pressable>
          </View>
        ) : null}
      </StandardCard>
    );
  };

  const listHeader = (count: number, add: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text variant="heading" style={{ flex: 1, fontSize: 20, fontWeight: '800' }}>
        {plural(locale, count, t.company.employeeCount)}
      </Text>
      {add ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(people)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 38,
            paddingHorizontal: 14,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.buttonPrimary,
          }}
        >
          <Ionicons name="add" size={iconSize.md} color={theme.color.onButtonPrimary} />
          <Text variant="caption" style={{ color: theme.color.onButtonPrimary, fontWeight: '700' }}>
            {t.company.qaAddEmployee}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const chipGroup = <T extends string>(
    title: string,
    value: T,
    options: readonly { value: T; label: string }[],
    onChange: (next: T) => void,
  ) => (
    <View style={{ gap: 6 }}>
      <Text variant="caption" tone="muted" style={{ fontWeight: '600' }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
              style={{
                paddingHorizontal: 14,
                height: 34,
                justifyContent: 'center',
                borderRadius: theme.radius.pill,
                backgroundColor: on ? theme.color.buttonPrimary : theme.color.brandSoft,
              }}
            >
              <Text
                variant="caption"
                style={{
                  fontWeight: '600',
                  color: on ? theme.color.onButtonPrimary : theme.color.textMuted,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <SectionShell groupId={groupId} view={view}>
      <View style={{ marginHorizontal: -theme.spacing.lg }}>
        <TabPills
          options={tabs}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setQuery('');
          }}
        />
      </View>

      {tab === 'employees' || tab === 'notEmployed' ? (
        <>
          {tab === 'employees' && activeToday ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace(`/group/${groupId}/company-people`)}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                height: 34,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                {t.company.overviewActiveToday}
              </Text>
              <Ionicons name="close-circle-outline" size={iconSize.sm} color={theme.color.brand} />
            </Pressable>
          ) : null}
          {searchRow(t.company.searchEmployees, true)}
          {listHeader(shown.length, tab === 'employees')}
          <StandardCard>
            {shown.map((m, i) => rowFor(m, i < shown.length - 1))}
            {shown.length === 0 ? (
              <Text variant="caption" tone="muted" align="center" style={{ paddingVertical: 16 }}>
                {(tab === 'notEmployed' ? former : employees).length > 0
                  ? t.company.noEmployeesMatch
                  : t.company.noEmployees}
              </Text>
            ) : null}
          </StandardCard>
          <Text variant="caption" tone="muted">
            {t.company.historyMoves}
          </Text>
        </>
      ) : null}

      {tab === 'managers' ? (
        <>
          {searchRow(t.company.searchManagers, false)}
          <SectionHeader title={`${t.company.sectionOwners} (${owners.length})`} />
          {ownerCard}
          <SectionHeader
            title={`${t.company.tabManagers} (${managers.length})`}
            trailing={
              employees.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPromoting(true)}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
                  <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                    {t.company.addManager}
                  </Text>
                </Pressable>
              ) : undefined
            }
          />
          {managers.length === 0 ? (
            <StandardCard style={{ padding: 16, gap: 12 }}>
              <ManagerTeamArt />
              <Text variant="heading" align="center">
                {t.company.managersEmptyTitle}
              </Text>
              <Text variant="caption" tone="muted" align="center">
                {t.company.managersEmptyBody}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => (employees.length ? setPromoting(true) : router.push(people))}
                style={{
                  alignSelf: 'center',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.buttonPrimary,
                  paddingHorizontal: 22,
                  paddingVertical: 12,
                }}
              >
                <Ionicons name="add-circle-outline" size={20} color={theme.color.onButtonPrimary} />
                <Text style={{ color: theme.color.onButtonPrimary, fontWeight: '700' }}>
                  {t.company.makeManagerAction}
                </Text>
              </Pressable>
              <View style={{ height: 1, backgroundColor: theme.color.border, marginVertical: 4 }} />
              <Text variant="title">{t.company.whyManagers}</Text>
              {(
                [
                  [
                    'people-outline',
                    'organizeTeams',
                    'organizeTeamsBody',
                    theme.color.brandSoft,
                    theme.color.brand,
                  ],
                  ['wallet-outline', 'managerPools', 'managerPoolsBody', BLUE_SOFT, BLUE],
                  [
                    'document-text-outline',
                    'controlApprove',
                    'controlApproveBody',
                    GREEN_SOFT,
                    GREEN,
                  ],
                ] as const
              ).map(([icon, title, body, bg, fg]) => (
                <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ padding: 10, borderRadius: 24, backgroundColor: bg }}>
                    <Ionicons name={icon} size={22} color={fg} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: '700' }}>{t.company[title]}</Text>
                    <Text variant="caption" tone="muted">
                      {t.company[body]}
                    </Text>
                  </View>
                </View>
              ))}
            </StandardCard>
          ) : (
            <>
              {shownManagers.map(managerCard)}
              {employees.length > 0 ? (
                <StandardCard>
                  <ListRow
                    title={t.company.makeManagerPick}
                    leading={
                      <Ionicons
                        name="ribbon-outline"
                        size={iconSize.md}
                        color={theme.color.brand}
                      />
                    }
                    onPress={() => setPromoting(true)}
                  />
                </StandardCard>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {tab === 'owners' ? (
        <>
          <SectionHeader title={`${t.company.sectionOwners} (${owners.length})`} />
          {ownerCard}
        </>
      ) : null}

      <Sheet visible={filtering} onClose={() => setFiltering(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          {departments.length > 0
            ? chipGroup(
                t.company.filterDepartment,
                departmentFilter ?? '',
                [
                  { value: '', label: t.company.empFilterAll },
                  ...departments.map((d) => ({ value: d.id, label: d.name })),
                ],
                (next) => setDepartmentFilter(next || null),
              )
            : null}
          {view.isOwner && managers.length > 0
            ? chipGroup(
                t.company.manager,
                managerFilter ?? '',
                [
                  { value: '', label: t.company.empFilterAll },
                  ...managers.map((m) => ({
                    value: m.id,
                    label: displayName(m, null, null, t.misc.someone),
                  })),
                ],
                (next) => setManagerFilter(next || null),
              )
            : null}
          {chipGroup<MarkFilter>(
            t.company.filterAttendance,
            markFilter,
            [
              { value: 'all', label: t.company.empFilterAll },
              { value: 'present', label: t.company.attendancePresent },
              { value: 'half', label: t.company.attHalfDay },
              { value: 'absent', label: t.company.attendanceAbsent },
              { value: 'unmarked', label: t.company.attNotMarked },
            ],
            setMarkFilter,
          )}
          {chipGroup<BalanceFilter>(
            t.company.filterBalance,
            balanceFilter,
            [
              { value: 'all', label: t.company.empFilterAll },
              { value: 'owesCompany', label: t.company.empFilterOwes },
              { value: 'companyOwes', label: t.company.empFilterCompanyOwes },
              { value: 'settled', label: t.company.empFilterSettled },
            ],
            setBalanceFilter,
          )}
          {anyFilter ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setBalanceFilter('all');
                setMarkFilter('all');
                setDepartmentFilter(null);
                setManagerFilter(null);
              }}
              style={{ alignSelf: 'flex-start' }}
            >
              <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                {t.company.filterClear}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Sheet>
      {employmentMember ? (
        <CompanyEmploymentControl
          key={employmentMember.id}
          groupId={groupId}
          member={employmentMember}
          autoOpen
          onClose={() => setEmploymentMember(null)}
        />
      ) : null}
      {typeMember ? (
        <EmploymentTypeSheet
          key={typeMember.id}
          groupId={groupId}
          memberId={typeMember.id}
          current={typeMember.employment_type}
          visible
          onClose={() => setTypeMember(null)}
        />
      ) : null}
      <Sheet visible={promoting} onClose={() => setPromoting(false)} closeLabel={t.common.close}>
        <View>
          {employees.map((m, i) => (
            <ListRow
              key={m.id}
              leading={
                <PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={36} />
              }
              title={displayName(m, null, null, t.misc.someone)}
              subtitle={
                [m.employee_id, departmentName(departments, m.department_id)]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              onPress={() => {
                setPromoting(false);
                role.mutate({ memberId: m.id, role: 'manager' });
              }}
              divider={i < employees.length - 1}
            />
          ))}
        </View>
      </Sheet>
    </SectionShell>
  );
}
