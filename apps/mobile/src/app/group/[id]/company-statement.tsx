/** One employee, opened from People or the company summary: identity, tabs, and the admin menu. */

import { useRef, useState } from 'react';
import {
  EMPLOYEE_ID_MAX,
  normaliseEmployeeId,
  format,
  money,
  type CurrencyCode,
} from '@waves/core';

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Screen, Text, iconSize, useTheme } from '@waves/ui';

import { EditTextSheet } from '@/components/EditTextSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { type MenuAnchor } from '@/components/SortMenu';
import { MyDatesSheet } from '@/components/company/CompanyCalendarSheets';
import { CompanyEmploymentControl } from '@/components/company/CompanyEmploymentControl';
import { DepartmentSheet } from '@/components/company/DepartmentSheet';
import {
  EmploymentTypeSheet,
  useEmploymentTypeLabel,
} from '@/components/company/EmploymentTypeSheet';
import { AttendanceMonth } from '@/components/company/AttendanceMonth';
import { CompanyStatementView } from '@/components/company/CompanyStatementView';
import { CompanyTeamCard } from '@/components/company/CompanyTeamCard';
import { EmployeeIdentity } from '@/components/company/employee/EmployeeIdentity';
import {
  birthdayText,
  DetailRow,
  OverviewTab,
  type EmployeeTab,
} from '@/components/company/employee/EmployeeTabs';
import { ScenicBody, ScenicHeader, SegmentedPills, StandardCard } from '@/components/standard';
import { canSetEmployment, isNotEmployed } from '@/data/companyEmployment';
import { canSetEmploymentType } from '@/data/companyPeople';
import { useCalendar } from '@/data/companyCalendar';
import { departmentName, useDepartments } from '@/data/companyDepartments';
import {
  useCompanyEntries,
  useEmployeeIdTaken,
  useSetEmployeeId,
  useCompanyProjectMembers,
  useCompanyProjects,
} from '@/data/companyEntries';
import { useActiveToday } from '@/data/companyOverview';
import { useAttendance, useWorkdayAccess, useWorkTasks } from '@/data/companyWorkday';
import { employeeDue, hasHistory } from '@/data/employeeDetail';
import { useRemoveMember } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { displayName } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { showDate } from '@/lib/expenseDay';
import { measureAnchor } from '@/lib/measureAnchor';
import { router } from '@/lib/navigation';
import type { CompanyPeriod } from '@/lib/companyPeriod';

export default function CompanyStatementScreen() {
  const { id, member: memberParam } = useLocalSearchParams<{ id: string; member?: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm, notify } = useDialog();
  const view = useCompanyEntries(groupId);
  const workdayAccess = useWorkdayAccess(groupId);
  const departments = useDepartments(groupId);
  const calendar = useCalendar(groupId);
  const marks = useAttendance(groupId);
  const tasks = useWorkTasks(groupId);
  const active = useActiveToday(groupId);
  const removeMember = useRemoveMember(groupId);
  const [departmentOpen, setDepartmentOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [employmentOpen, setEmploymentOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const dotsRef = useRef<View>(null);
  const [tab, setTab] = useState<EmployeeTab>('overview');
  const [attMonth, setAttMonth] = useState(todayIso().slice(0, 7));
  const [period, setPeriod] = useState<CompanyPeriod>('all');
  const typeLabel = useEmploymentTypeLabel();
  const setEmployeeId = useSetEmployeeId(groupId);
  const isTaken = useEmployeeIdTaken(groupId, view.members);
  const [editingId, setEditingId] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState(false);
  // The member list only holds who this viewer may read, so a guessed id finds nothing.
  const member = view.members.find((m) => m.id === memberParam) ?? null;
  const detail = !!member && view.isAdmin && member.id !== view.me?.id;
  const projects = useCompanyProjects(groupId);
  const siteIds = useCompanyProjectMembers(groupId).get(member?.id ?? '') ?? [];
  const site = projects.find((p) => !p.archived_at && siteIds.includes(p.id));
  const phone = member?.invite_phone?.trim() || null;

  const employee = member?.role === 'member';
  const canEdit = detail && !!member && view.manageableIds.has(member.id) && !view.suspended;
  const canType =
    detail && !!member && employee && canSetEmploymentType(view.me, member, view.suspended);
  const canEmployment = detail && !!member && canSetEmployment(view.me, member, view.suspended);
  const canDelete = canEmployment && employee && !member?.left_at;
  const showAttendance =
    !!member &&
    employee &&
    workdayAccess.enabled &&
    (workdayAccess.people.some((person) => person.id === member.id) ||
      workdayAccess.me?.id === member.id);
  const dates = member ? calendar.dates.get(member.id) : undefined;
  const canDates = canEdit && !!member?.profile_id;
  const own = !!member && member.id === view.me?.id;
  const birthday = birthdayText(dates, locale, own);
  const joined = dates?.joinedOn ? showDate(dates.joinedOn, locale) : null;
  const datesSummary = [birthday, joined && `${t.company.joiningDate}: ${joined}`]
    .filter(Boolean)
    .join(' · ');
  const notSet = t.company.rateNotSet;
  const typeText = (member && typeLabel(member.employment_type)) ?? t.company.empTypeNone;
  const deptText =
    (member && departmentName(departments, member.department_id)) ?? t.company.departmentNone;
  const rate = (minor: string | null | undefined, fallback: bigint | null): string => {
    const value = minor ? BigInt(minor) : fallback;
    return value === null
      ? notSet
      : format(money(value, view.currency as CurrencyCode), { locale });
  };
  const manager = member?.manager_id
    ? view.members.find((m) => m.id === member.manager_id)
    : undefined;

  const openIdEditor = (): void => {
    setIdError(null);
    setEditingId(true);
  };
  const confirmDelete = async (): Promise<void> => {
    if (!member || removeMember.isPending) return;
    const name = displayName(member, null, null, t.misc.someone);
    if (
      !(await confirm({
        title: fill(t.company.deleteEmployeeTitle, { name }),
        body: t.company.deleteEmployeeBody,
        confirmLabel: t.company.deleteEmployee,
        tone: 'danger',
      }))
    )
      return;
    try {
      await removeMember.mutateAsync(member.id);
      router.back();
    } catch (caught) {
      await notify({
        title: t.company.employmentFailed,
        body: friendlyError(caught, t.misc.tryAgainMoment, 'company.removeEmployee'),
      });
    }
  };
  const history = member ? hasHistory(member.id, view.entries, marks, tasks) : true;
  const menuItems: OverflowMenuItem[] = member
    ? [
        ...(canEdit
          ? [
              {
                icon: 'create-outline' as const,
                label: t.company.editEmployee,
                onPress: () => setTab('details'),
              },
            ]
          : []),
        ...(canType
          ? [
              {
                icon: 'briefcase-outline' as const,
                label: t.company.changeEmploymentType,
                onPress: () => setTypeOpen(true),
              },
            ]
          : []),
        ...(canEmployment
          ? [
              isNotEmployed(member)
                ? {
                    icon: 'checkmark-circle-outline' as const,
                    label: t.company.markEmployed,
                    onPress: () => setEmploymentOpen(true),
                  }
                : {
                    icon: 'person-remove-outline' as const,
                    label: t.company.markNotEmployed,
                    tone: 'danger' as const,
                    onPress: () => setEmploymentOpen(true),
                  },
            ]
          : []),
        ...(canDelete
          ? [
              {
                icon: 'trash-outline' as const,
                label: t.company.deleteEmployee,
                disabled: history,
                ...(history ? { hint: t.company.deleteHasHistory } : null),
                onPress: () => void confirmDelete(),
              },
            ]
          : []),
      ]
    : [];
  const tabs = [
    { value: 'overview' as const, label: t.company.tabOverview },
    ...(showAttendance ? [{ value: 'attendance' as const, label: t.company.attendanceTitle }] : []),
    { value: 'expenses' as const, label: t.company.expenses },
    { value: 'details' as const, label: t.company.tabDetails },
  ];
  const { due, total: dueTotal } =
    member && detail ? employeeDue(view.entries, member.id) : { due: [], total: 0n };

  const menuButton =
    menuItems.length > 0 ? (
      <Pressable
        ref={dotsRef}
        accessibilityRole="button"
        accessibilityLabel={t.company.employeeOptions}
        onPress={() =>
          measureAnchor(dotsRef, (a) => {
            setAnchor(a);
            setMenuOpen(true);
          })
        }
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.scheme === 'dark' ? 'rgba(20,20,34,0.82)' : '#FFFFFF',
        }}
      >
        <Ionicons name="ellipsis-vertical" size={iconSize.lg} color={theme.color.text} />
      </Pressable>
    ) : undefined;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={member ? '' : t.company.myStatement}
          circleBack={!!member}
          action={menuButton}
        >
          {member ? (
            <EmployeeIdentity
              member={member}
              activeToday={!!active?.activeIds.has(member.id)}
              typeLabel={employee ? typeText : null}
              departmentLabel={employee ? deptText : null}
              onEditId={canEdit ? openIdEditor : undefined}
              onPickType={canType ? () => setTypeOpen(true) : undefined}
              onPickDepartment={canEdit && employee ? () => setDepartmentOpen(true) : undefined}
            />
          ) : null}
        </ScenicHeader>
        <ScenicBody>
          {member && detail ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: theme.spacing.sm }}
                style={{ flexGrow: 0 }}
              >
                <SegmentedPills options={tabs} value={tab} onChange={setTab} />
              </ScrollView>
              {tab === 'overview' ? (
                <OverviewTab
                  groupId={groupId}
                  memberId={member.id}
                  currency={view.currency}
                  dueCount={due.length}
                  dueTotal={dueTotal}
                  month={attMonth}
                  onMonth={setAttMonth}
                  showAttendance={showAttendance}
                  onTab={setTab}
                  onAddExpense={
                    canEdit
                      ? () => router.push(`/group/${groupId}/company-entry?member=${member.id}`)
                      : undefined
                  }
                  datesSummary={canDates || datesSummary ? datesSummary : null}
                  onDates={canDates ? () => setDatesOpen(true) : undefined}
                  typeText={typeText}
                  departmentText={deptText}
                  joinedText={joined ?? notSet}
                  onType={canType ? () => setTypeOpen(true) : undefined}
                  onDepartment={canEdit && employee ? () => setDepartmentOpen(true) : undefined}
                />
              ) : null}
              {tab === 'attendance' && showAttendance ? (
                <AttendanceMonth
                  groupId={groupId}
                  memberId={member.id}
                  list
                  month={attMonth}
                  onMonth={setAttMonth}
                />
              ) : null}
              {tab === 'expenses' ? (
                <CompanyStatementView
                  view={view}
                  member={member}
                  period={period}
                  onPeriod={setPeriod}
                  groupId={groupId}
                  detail
                />
              ) : null}
              {tab === 'details' ? (
                <>
                  <StandardCard
                    style={{
                      paddingVertical: theme.spacing.xs,
                      paddingHorizontal: theme.spacing.md,
                    }}
                  >
                    <DetailRow
                      icon="id-card-outline"
                      label={t.company.employeeId}
                      value={member.employee_id || notSet}
                      onPress={canEdit ? openIdEditor : undefined}
                    />
                    {employee ? (
                      <>
                        <DetailRow
                          icon="briefcase-outline"
                          label={t.company.employmentType}
                          value={typeText}
                          onPress={canType ? () => setTypeOpen(true) : undefined}
                        />
                        <DetailRow
                          icon="people-outline"
                          label={t.company.department}
                          value={deptText}
                          onPress={canEdit ? () => setDepartmentOpen(true) : undefined}
                        />
                        <DetailRow
                          icon="git-network-outline"
                          label={t.company.reportsTo}
                          value={
                            manager
                              ? displayName(manager, null, null, t.misc.someone)
                              : t.company.owners
                          }
                        />
                      </>
                    ) : null}
                    {phone ? (
                      <DetailRow
                        icon="call-outline"
                        label={t.company.detailPhone}
                        value={phone}
                        onPress={() => void Linking.openURL(`tel:${phone}`)}
                      />
                    ) : null}
                    {member.invite_email ? (
                      <DetailRow
                        icon="mail-outline"
                        label={t.company.detailEmail}
                        value={member.invite_email}
                      />
                    ) : null}
                    {site ? (
                      <DetailRow
                        icon="location-outline"
                        label={t.company.sites}
                        value={site.name}
                      />
                    ) : null}
                    <DetailRow
                      icon="calendar-outline"
                      label={t.company.joiningDate}
                      value={joined ?? notSet}
                      onPress={canDates ? () => setDatesOpen(true) : undefined}
                    />
                    <DetailRow
                      icon="gift-outline"
                      label={t.calendar.birthday}
                      value={birthday ?? notSet}
                      onPress={canDates ? () => setDatesOpen(true) : undefined}
                    />
                    {employee ? (
                      <>
                        <DetailRow
                          icon="cash-outline"
                          label={t.company.rateTitle}
                          value={rate(member.daily_rate_minor, view.defaultRateMinor)}
                        />
                        <DetailRow
                          icon="car-outline"
                          label={t.company.detailMileage}
                          value={rate(member.mileage_rate_minor, view.defaultMileageRateMinor)}
                          divider={false}
                        />
                      </>
                    ) : null}
                  </StandardCard>
                  <CompanyTeamCard groupId={groupId} view={view} member={member} />
                </>
              ) : null}
            </>
          ) : null}
          {member && !detail ? (
            <>
              {showAttendance ? <AttendanceMonth groupId={groupId} memberId={member.id} /> : null}
              <CompanyTeamCard groupId={groupId} view={view} member={member} />
              <CompanyStatementView
                view={view}
                member={member}
                period="all"
                groupId={groupId}
                detail={false}
              />
            </>
          ) : !member && view.ready ? (
            <Text variant="caption" tone="muted">
              {t.company.none}
            </Text>
          ) : null}
        </ScenicBody>
      </ScrollView>
      <OverflowMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={menuItems}
        anchor={anchor}
      />
      {member && employmentOpen ? (
        <CompanyEmploymentControl
          key={member.id}
          groupId={groupId}
          member={member}
          autoOpen
          onClose={() => setEmploymentOpen(false)}
        />
      ) : null}
      {member && datesOpen ? (
        <MyDatesSheet
          groupId={groupId}
          visible
          onClose={() => setDatesOpen(false)}
          memberId={member.id}
        />
      ) : null}
      {member ? (
        <EmploymentTypeSheet
          groupId={groupId}
          memberId={member.id}
          current={member.employment_type}
          visible={typeOpen}
          onClose={() => setTypeOpen(false)}
        />
      ) : null}
      {member ? (
        <DepartmentSheet
          groupId={groupId}
          visible={departmentOpen}
          onClose={() => setDepartmentOpen(false)}
          memberId={member.id}
          departmentId={member.department_id}
        />
      ) : null}
      <EditTextSheet
        visible={editingId}
        title={t.company.employeeId}
        value={member?.employee_id ?? ''}
        maxLength={EMPLOYEE_ID_MAX}
        autoCapitalize="none"
        saving={checkingId || setEmployeeId.isPending}
        error={idError}
        onClose={() => setEditingId(false)}
        onSave={(raw) => {
          if (!member || !view.manageableIds.has(member.id) || checkingId) return;
          const employeeId = normaliseEmployeeId(raw);
          setIdError(null);
          setCheckingId(true);
          void (async () => {
            try {
              if (employeeId && (await isTaken(employeeId, member.id))) {
                setIdError(t.company.employeeIdTaken);
                return;
              }
              await setEmployeeId.mutateAsync({ memberId: member.id, employeeId });
              setEditingId(false);
            } catch (caught) {
              setIdError(friendlyError(caught, t.misc.tryAgainMoment, 'company.employeeId'));
            } finally {
              setCheckingId(false);
            }
          })();
        }}
      />
      {member && !detail && (view.manageableIds.has(member.id) || view.me?.id === member.id) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.addEntry}
          onPress={() => router.push(`/group/${groupId}/company-entry?member=${member.id}`)}
          style={{
            position: 'absolute',
            right: theme.spacing.lg,
            bottom: clearance,
            width: 60,
            height: 60,
            borderRadius: 30,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.buttonPrimary,
          }}
        >
          <Ionicons name="add" size={iconSize.xl} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Screen>
  );
}
