/**
 * People (the Team tab's first segment; TeamScreen draws the header): one compact card per person.
 * Default list = employed employees and managers (an owner's view also holds the owners, opt-in via
 * the filter sheet; a manager's view is already only their team). Every per-person number (today's
 * mark, open tasks, balance) is computed once per render into a map, never per row.
 * shortcut: no "On leave" (no leave data exists yet).
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { PersonCard } from '@/components/company/bar/PersonCard';
import { useCompanyEntries } from '@/data/companyEntries';
import { useActiveToday } from '@/data/companyOverview';
import { useDepartments } from '@/data/companyDepartments';
import {
  DEFAULT_PEOPLE_FILTER,
  attendanceToday,
  balancesByMember,
  listPeople,
  managerBalances,
  openTasksToday,
  wholeMoney,
  type Balance,
  type PeopleFilter,
  type PeopleMark,
  type PeopleRow,
  type PeopleSort,
  type PersonRole,
} from '@/data/companyPeople';
import { useAttendance, useWorkTasks } from '@/data/companyWorkday';
import { employmentPeople, isNotEmployed } from '@/data/companyEmployment';
import { todayIso } from '@/data/personal';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

const SETTLED: Balance = { kind: 'settled', amount: 0n };

export function CompanyPeople({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const params = useLocalSearchParams<{ filter?: string }>();
  const activeToday = params.filter === 'activeToday';
  const active = useActiveToday(groupId);
  const departments = useDepartments(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [filter, setFilter] = useState<PeopleFilter>(DEFAULT_PEOPLE_FILTER);
  const [sort, setSort] = useState<PeopleSort>('name');

  const today = todayIso();
  const live = view.members.filter((m) => !m.left_at);
  // A manager's server-side view already holds only their team; never list themself.
  const others = view.members.filter((m) => m.id !== view.me?.id);
  const employeeRows = others.filter(
    (m) => m.role === 'member' || (m.role === 'manager' && !!m.left_at),
  );
  const managers = live.filter((m) => m.role === 'manager' && m.id !== view.me?.id);
  const owners = view.isOwner ? live.filter((m) => m.role === 'admin') : [];

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

  const byId = new Map<string, MemberRow>();
  const rows: PeopleRow[] = [
    ...employmentPeople(employeeRows, false),
    ...managers,
    ...owners,
    ...employmentPeople(employeeRows, true),
  ].map((m) => {
    byId.set(m.id, m);
    const owner = m.role === 'admin';
    const gone = isNotEmployed(m);
    return {
      id: m.id,
      name: displayName(m, null, null, t.misc.someone),
      role: owner ? 'owner' : m.role === 'manager' ? 'manager' : 'employee',
      former: gone,
      departmentId: m.department_id ?? null,
      mark: owner || gone ? null : attendanceToday(marks, m.id, today),
      tasks: tasks.get(m.id) ?? 0,
      balance: owner
        ? null
        : m.role === 'manager'
          ? (poolBalances.get(m.id) ?? SETTLED)
          : (balances.get(m.id) ?? SETTLED),
    };
  });
  const shown = listPeople(rows, filter, sort, query).filter(
    (r) => r.former || !activeToday || !!active?.activeIds.has(r.id),
  );

  const thread = (memberId: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${memberId}`);
  const customised =
    sort !== 'name' ||
    filter.status !== 'employed' ||
    filter.departmentId !== null ||
    filter.mark !== null ||
    filter.roles.length !== 2 ||
    !filter.roles.includes('employee') ||
    !filter.roles.includes('manager');

  const roleOptions: { value: PersonRole; label: string }[] = [
    { value: 'employee', label: t.company.roleEmployee },
    { value: 'manager', label: t.company.manager },
    ...(view.isOwner ? [{ value: 'owner' as const, label: t.company.pillOwner }] : []),
  ];
  const toggleRole = (role: PersonRole) =>
    setFilter((f) => {
      const on = f.roles.includes(role);
      // Never leave the list with no role at all.
      if (on && f.roles.length === 1) return f;
      return { ...f, roles: on ? f.roles.filter((r) => r !== role) : [...f.roles, role] };
    });

  const round = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    onPress: () => void,
    on = false,
  ) => (
    <Pressable
      key={icon}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? theme.color.brand : theme.color.brandSoft,
      }}
    >
      <Ionicons
        name={icon}
        size={iconSize.md}
        color={on ? theme.color.onBrand : theme.color.brand}
      />
    </Pressable>
  );

  const chips = <T extends string>(
    title: string,
    options: readonly { value: T; label: string }[],
    isOn: (value: T) => boolean,
    onPick: (value: T) => void,
  ) => (
    <View style={{ gap: 6 }}>
      <Text variant="caption" tone="muted" style={{ fontWeight: '600' }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = isOn(o.value);
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onPick(o.value)}
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
    <ScrollView
      contentContainerStyle={{
        padding: theme.spacing.lg,
        gap: 10,
        paddingBottom: clearance + 24,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
        {searching ? (
          <>
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                height: 40,
                paddingHorizontal: 14,
                gap: 8,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.surface,
              }}
            >
              <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder={t.company.searchEmployees}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={t.company.searchEmployees}
                style={{
                  flex: 1,
                  paddingVertical: 0,
                  fontSize: theme.typography.body.fontSize,
                  color: theme.color.text,
                }}
              />
            </View>
            {round('close', t.common.close, () => {
              setSearching(false);
              setQuery('');
            })}
          </>
        ) : (
          <>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{ fontSize: 26, lineHeight: 32, fontWeight: '800', flexShrink: 1 }}
            >
              {t.company.barTeam}
            </Text>
            {view.suspended
              ? null
              : round('add', t.company.qaAddEmployee, () =>
                  router.push(`/group/${groupId}/members`),
                )}
            <View style={{ flex: 1 }} />
            {round('search', t.company.searchEmployees, () => setSearching(true), !!query)}
            {view.isOwner
              ? round('git-network-outline', t.company.hierTitle, () =>
                  router.push(`/group/${groupId}/company-hierarchy`),
                )
              : null}
            {round(
              'swap-vertical',
              t.company.filterEmployees,
              () => setFiltering(true),
              customised,
            )}
          </>
        )}
      </View>

      {activeToday ? (
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

      {shown.map((r) => {
        const m = byId.get(r.id)!;
        return (
          <PersonCard
            key={r.id}
            member={m}
            name={r.name}
            ghost={isGhost(m)}
            role={r.role}
            employeeId={m.employee_id}
            note={
              r.former && m.employment_ended_on
                ? showDate(m.employment_ended_on, locale)
                : undefined
            }
            mark={r.mark}
            showMark={!r.former && r.role !== 'owner'}
            tasks={plural(locale, r.tasks, t.company.tasksCount)}
            balance={r.balance}
            balanceText={r.balance ? wholeMoney(r.balance.amount, view.currency, locale) : ''}
            muted={r.former}
            onPress={() => thread(r.id)}
          />
        );
      })}
      {shown.length === 0 ? (
        <Text variant="caption" tone="muted" align="center" style={{ paddingVertical: 16 }}>
          {rows.some((r) => r.former === (filter.status === 'notEmployed'))
            ? t.company.noEmployeesMatch
            : t.company.noEmployees}
        </Text>
      ) : null}

      <Sheet visible={filtering} onClose={() => setFiltering(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.md }}>
          {chips<PeopleSort>(
            t.company.peopleSortBy,
            [
              { value: 'name', label: t.common.name },
              { value: 'attendance', label: t.company.attendanceTitle },
              { value: 'balance', label: t.company.filterBalance },
              { value: 'tasks', label: t.company.teamTabTasks },
            ],
            (v) => v === sort,
            setSort,
          )}
          {chips<PersonRole>(
            t.company.roleLabel,
            roleOptions,
            (v) => filter.roles.includes(v),
            toggleRole,
          )}
          {chips<PeopleFilter['status']>(
            t.company.workStatus,
            [
              { value: 'employed', label: t.company.employed },
              { value: 'notEmployed', label: t.company.notEmployed },
            ],
            (v) => v === filter.status,
            (status) => setFilter((f) => ({ ...f, status })),
          )}
          {departments.length > 0
            ? chips<string>(
                t.company.filterDepartment,
                [
                  { value: '', label: t.company.empFilterAll },
                  ...departments.map((d) => ({ value: d.id, label: d.name })),
                ],
                (v) => v === (filter.departmentId ?? ''),
                (v) => setFilter((f) => ({ ...f, departmentId: v || null })),
              )
            : null}
          {chips<PeopleMark | ''>(
            t.company.filterAttendance,
            [
              { value: '', label: t.company.empFilterAll },
              { value: 'present', label: t.company.attendancePresent },
              { value: 'half', label: t.company.attHalfDay },
              { value: 'absent', label: t.company.attendanceAbsent },
              { value: 'unmarked', label: t.company.attNotMarked },
            ],
            (v) => v === (filter.mark ?? ''),
            (v) => setFilter((f) => ({ ...f, mark: v || null })),
          )}
          {customised ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setFilter(DEFAULT_PEOPLE_FILTER);
                setSort('name');
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
    </ScrollView>
  );
}
