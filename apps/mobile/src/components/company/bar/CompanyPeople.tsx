/**
 * People: one list with Owners, Managers and Employees. An owner sees all three; a manager
 * sees only their own team ("My team"). Employee rows carry the status pill, the employee
 * ID and a ⋮ menu.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { dashboardStats } from '@waves/core';
import { Sheet, Text, iconSize, useTheme } from '@waves/ui';

import { ManagerCashRowPublic } from '@/components/company/CompanyCash';
import { ManagerTeamArt } from '@/components/company/dashboard/art';
import {
  BLUE,
  BLUE_SOFT,
  GREEN,
  GREEN_SOFT,
  RolePill,
  useMoney,
} from '@/components/company/dashboard/parts';
import { EmployeeRow } from '@/components/company/dashboard/EmployeeRow';
import { SectionShell } from '@/components/company/bar/SectionShell';
import { PersonAvatar } from '@/components/PersonAvatar';
import { ListRow, PillButton, SegmentedPills, StandardCard } from '@/components/standard';
import { CompanyEmploymentControl } from '@/components/company/CompanyEmploymentControl';
import { useCompanyEntries } from '@/data/companyEntries';
import { useActiveToday } from '@/data/companyOverview';
import { departmentName, useDepartments } from '@/data/companyDepartments';
import { useSetMemberRole } from '@/data/hooks';
import { canSetEmployment, employmentPeople, isNotEmployed } from '@/data/companyEmployment';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';

export function CompanyPeople({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const params = useLocalSearchParams<{ filter?: string }>();
  const activeToday = params.filter === 'activeToday';
  const active = useActiveToday(groupId);
  const departments = useDepartments(groupId);
  const fmt = useMoney(view.currency);
  const role = useSetMemberRole(groupId);
  const [promoting, setPromoting] = useState(false);
  const [query, setQuery] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [employmentFilter, setEmploymentFilter] = useState<'employed' | 'notEmployed'>('employed');
  const [employmentMember, setEmploymentMember] = useState<(typeof view.members)[number] | null>(
    null,
  );
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'owesCompany' | 'companyOwes' | 'settled'
  >('all');
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);

  const live = view.members.filter((m) => !m.left_at);
  const owners = live.filter((m) => m.role === 'admin');
  const managers = live.filter((m) => m.role === 'manager');
  // A manager's server-side view already holds only their team; never list themself.
  const employeeRows = view.members.filter(
    (m) => (m.role === 'member' || (m.role === 'manager' && !!m.left_at)) && m.id !== view.me?.id,
  );
  const employees = employmentPeople(employeeRows, false);
  const displayedEmployees = employmentPeople(employeeRows, employmentFilter === 'notEmployed');
  const teamOf = (managerId: string): number =>
    employees.filter((m) => m.manager_id === managerId).length;
  const thread = (memberId: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${memberId}`);
  const people = `/group/${groupId}/members`;

  const empKind = (id: string): 'settled' | 'companyOwes' | 'owesCompany' => {
    const net = dashboardStats(view.entries, [id], todayIso());
    return net.owes > 0n ? 'companyOwes' : net.advancesOutstanding > 0n ? 'owesCompany' : 'settled';
  };
  const q = query.trim().toLowerCase();
  const shownEmployees = displayedEmployees.filter(
    (m) =>
      (statusFilter === 'all' || empKind(m.id) === statusFilter) &&
      (!departmentFilter || m.department_id === departmentFilter) &&
      (!activeToday || !!active?.activeIds.has(m.id)) &&
      (!q || displayName(m, null, null, t.misc.someone).toLowerCase().includes(q)),
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
    <SectionShell groupId={groupId} view={view}>
      {view.isOwner ? (
        <>
          <Text variant="title">{t.company.sectionOwners}</Text>
          <StandardCard>
            {owners.map((m, i) => (
              <ListRow
                key={m.id}
                leading={<PersonAvatar member={m} name={displayName(m)} size={40} />}
                title={displayName(m, null, null, t.misc.someone)}
                subtitle={
                  [m.employee_id, departmentName(departments, m.department_id)]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                trailing={<RolePill label={t.company.pillOwner} />}
                divider={i < owners.length - 1}
              />
            ))}
          </StandardCard>
          <Text variant="title">{t.company.tabManagers}</Text>
          <>
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
                  <Ionicons
                    name="add-circle-outline"
                    size={20}
                    color={theme.color.onButtonPrimary}
                  />
                  <Text style={{ color: theme.color.onButtonPrimary, fontWeight: '700' }}>
                    {t.company.makeManagerAction}
                  </Text>
                </Pressable>
                <View
                  style={{ height: 1, backgroundColor: theme.color.border, marginVertical: 4 }}
                />
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
            {employees.length > 0 && managers.length > 0 ? (
              <ListRow
                title={t.company.makeManagerPick}
                leading={
                  <Ionicons name="ribbon-outline" size={iconSize.md} color={theme.color.brand} />
                }
                onPress={() => setPromoting(true)}
              />
            ) : null}
          </>
        </>
      ) : null}
      <Text variant="title">{view.isOwner ? t.company.tabEmployees : t.company.tabMyTeam}</Text>
      <>
        {activeToday ? (
          <PillButton
            label={t.company.overviewActiveToday}
            icon="close-circle-outline"
            chevron={false}
            onPress={() => router.replace(`/group/${groupId}/company-people`)}
          />
        ) : null}
        <SegmentedPills
          options={[
            { value: 'employed', label: t.company.employed },
            { value: 'notEmployed', label: t.company.notEmployed },
          ]}
          value={employmentFilter}
          onChange={(value) => {
            setEmploymentFilter(value);
            setStatusFilter('all');
          }}
        />
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
              backgroundColor: statusFilter === 'all' ? theme.color.brandSoft : theme.color.brand,
            }}
          >
            <Ionicons
              name="options-outline"
              size={iconSize.md}
              color={statusFilter === 'all' ? theme.color.brand : theme.color.onBrand}
            />
          </Pressable>
        </View>
        <StandardCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 }}>
            <Text variant="body" style={{ flex: 1, fontWeight: '700' }}>
              {plural(locale, employees.length, t.company.employeeCount)}
            </Text>
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
                backgroundColor: theme.color.brand,
              }}
            >
              <Ionicons name="add" size={iconSize.md} color={theme.color.onBrand} />
              <Text variant="caption" style={{ color: theme.color.onBrand, fontWeight: '700' }}>
                {t.company.qaAddEmployee}
              </Text>
            </Pressable>
          </View>
          {shownEmployees.map((m, i) => {
            const kind = empKind(m.id);
            return (
              <EmployeeRow
                key={m.id}
                member={m}
                name={displayName(m, null, null, t.misc.someone)}
                ghost={isGhost(m)}
                marker={
                  (isNotEmployed(m)
                    ? [m.employment_ended_on]
                    : [m.employee_id, departmentName(departments, m.department_id)]
                  )
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                status={{
                  kind,
                  label: isNotEmployed(m)
                    ? t.company.notEmployed
                    : (balanceWords(m.id) ?? t.company.settled),
                }}
                muted={isNotEmployed(m)}
                menuLabel={t.company.employeeOptions}
                menuItems={[
                  {
                    icon: 'document-text-outline',
                    label: t.company.viewStatement,
                    onPress: () => thread(m.id),
                  },
                  ...(canSetEmployment(view.me, m, view.suspended)
                    ? [
                        {
                          icon: isNotEmployed(m)
                            ? ('checkmark-circle-outline' as const)
                            : ('person-remove-outline' as const),
                          label: isNotEmployed(m)
                            ? t.company.markEmployed
                            : t.company.markNotEmployed,
                          onPress: () => setEmploymentMember(m),
                        },
                      ]
                    : []),
                ]}
                onPress={() => thread(m.id)}
                divider={i < shownEmployees.length - 1}
              />
            );
          })}
          {displayedEmployees.length > 0 && shownEmployees.length === 0 ? (
            <Text variant="caption" tone="muted" align="center" style={{ paddingVertical: 16 }}>
              {t.company.noEmployeesMatch}
            </Text>
          ) : null}
        </StandardCard>
        <Text variant="caption" tone="muted">
          {t.company.historyMoves}
        </Text>
      </>
      <Sheet visible={filtering} onClose={() => setFiltering(false)} closeLabel={t.common.close}>
        <View>
          {departments.map((department, i) => (
            <ListRow
              key={department.id}
              title={department.name}
              trailing={
                departmentFilter === department.id ? (
                  <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
                ) : undefined
              }
              onPress={() => {
                setDepartmentFilter(departmentFilter === department.id ? null : department.id);
                setFiltering(false);
              }}
              divider={i < departments.length - 1}
            />
          ))}
          {(
            [
              ['all', t.company.empFilterAll],
              ['owesCompany', t.company.empFilterOwes],
              ['companyOwes', t.company.empFilterCompanyOwes],
              ['settled', t.company.empFilterSettled],
            ] as const
          ).map(([value, label], i) => (
            <ListRow
              key={value}
              title={label}
              trailing={
                statusFilter === value ? (
                  <Ionicons name="checkmark" size={iconSize.md} color={theme.color.brand} />
                ) : undefined
              }
              onPress={() => {
                setStatusFilter(value);
                setFiltering(false);
              }}
              divider={i < 3}
            />
          ))}
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
