import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { dashboardStats } from '@waves/core';
import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { EditTextSheet } from '@/components/EditTextSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { Sheet, Text, useTheme } from '@waves/ui';
import { ScenicBody, StandardCard } from '@/components/standard';
import { useMoney } from '@/components/company/dashboard/parts';
import {
  useAttendance,
  useSetAttendance,
  useWorkdayAccess,
  useWorkTasks,
  type AttendanceStatus,
} from '@/data/companyWorkday';
import {
  useCompanyEntries,
  useCompanyProjects,
  useCompanyProjectMembers,
} from '@/data/companyEntries';
import { useCalendar } from '@/data/companyCalendar';
import { useDepartments, departmentName } from '@/data/companyDepartments';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { plural, fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import type { MenuAnchor } from '@/components/SortMenu';
import {
  attendanceStatusLetter,
  dayCounts,
  matchesStatus,
  weekDays,
} from '@/lib/companyAttendance';
import { AttendanceRow, GREEN, RED } from './AttendanceRow';
import { AttendanceToolbar } from './AttendanceToolbar';

type Period = 'daily' | 'weekly' | 'monthly';
type StatusFilter = AttendanceStatus | 'unmarked';
export default function AttendanceView({
  groupId: id,
  embedded = false,
}: {
  groupId: string;
  /** Inside the Team shell, which draws the header and segment: no header of its own. */
  embedded?: boolean;
}) {
  const access = useWorkdayAccess(id),
    marks = useAttendance(id),
    save = useSetAttendance(id),
    tasks = useWorkTasks(id);
  const company = useCompanyEntries(id),
    sites = useCompanyProjects(id),
    siteMembers = useCompanyProjectMembers(id),
    departments = useDepartments(id);
  const { confirm } = useDialog();
  const { t, locale } = useStrings(),
    theme = useTheme(),
    clearance = useBottomClearance(),
    money = useMoney(company.currency);
  const today = todayIso();
  // The Overview opens this for the day and mark it was showing; anything else falls back to today / no filter.
  const { date: dateParam, status: statusParam } = useLocalSearchParams<{
    date?: string;
    status?: string;
  }>();
  const leave = useCalendar(id).leave;
  const [period, setPeriod] = useState<Period>('daily'),
    [date, setDate] = useState(
      typeof dateParam === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(dateParam) &&
        new Date(`${dateParam}T00:00:00Z`).toISOString().startsWith(dateParam) &&
        dateParam <= today
        ? dateParam
        : today,
    );
  const [search, setSearch] = useState(''),
    [filterOpen, setFilterOpen] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [menuAnchor, setMenuAnchor] = useState<MenuAnchor | 'open' | null>(null);
  const [department, setDepartment] = useState<string | null>(null),
    [manager, setManager] = useState<string | null>(null),
    [site, setSite] = useState<string | null>(null),
    [statusFilter, setStatusFilter] = useState<StatusFilter | null>(
      statusParam === 'present' || statusParam === 'absent' || statusParam === 'unmarked'
        ? statusParam
        : null,
    );
  const [noteFor, setNoteFor] = useState<string | null>(null),
    [pickFor, setPickFor] = useState<string | null>(null),
    [error, setError] = useState(false);
  const busy = save.isPending;
  const people = useMemo(
    () =>
      access.people.filter((p) => {
        const q = search.trim().toLowerCase();
        const mark = marks.get(`${p.id}|${date}`)?.status;
        return (
          (!q ||
            displayName(p).toLowerCase().includes(q) ||
            (p.employee_id ?? '').toLowerCase().includes(q)) &&
          (!department || p.department_id === department) &&
          (!manager || p.manager_id === manager) &&
          (!site || (siteMembers.get(site) ?? []).includes(p.id)) &&
          (!statusFilter ||
            (matchesStatus(mark, statusFilter) &&
              // Someone on approved leave is not "pending" (the Overview does not count them so).
              !(
                statusFilter === 'unmarked' &&
                leave.some(
                  (l) =>
                    l.status === 'approved' &&
                    l.memberId === p.id &&
                    l.startDay <= date &&
                    date <= l.endDay,
                )
              )))
        );
      }),
    [
      access.people,
      search,
      department,
      manager,
      site,
      siteMembers,
      statusFilter,
      marks,
      date,
      leave,
    ],
  );
  // The stat card counts everyone the viewer may mark; only the list below follows the filters.
  const counts = dayCounts(access.people, marks, date);
  const taskCount = useMemo(() => {
    const byPerson = new Map<string, number>();
    for (const task of tasks)
      if (task.day === date) byPerson.set(task.memberId, (byPerson.get(task.memberId) ?? 0) + 1);
    return byPerson;
  }, [tasks, date]);
  const balances = useMemo(() => {
    const byPerson = new Map<string, { owes: bigint; advances: bigint }>();
    for (const p of people) {
      const net = dashboardStats(company.entries, [p.id], today);
      byPerson.set(p.id, { owes: net.owes, advances: net.advancesOutstanding });
    }
    return byPerson;
  }, [people, company.entries, today]);
  const write = (memberId: string, status: AttendanceStatus | null, note: string | null) => {
    if (
      !access.enabled ||
      !access.canManage ||
      busy ||
      date > today ||
      leaveOf(memberId) === 'approved' ||
      !access.people.some((p) => p.id === memberId)
    )
      return;
    setError(false);
    save.mutate({ memberId, day: date, status, note }, { onError: () => setError(true) });
  };
  const labelDate = new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const days = weekDays(date);
  const statusText = (status: AttendanceStatus | undefined) =>
    status === 'present'
      ? t.company.attendancePresent
      : status === 'half'
        ? t.company.attendanceHalfDay
        : status === 'absent'
          ? t.company.attendanceAbsent
          : t.company.attendanceMark;
  const filterChips = <V extends string>(
    title: string,
    value: V | null,
    options: { value: V; label: string }[],
    change: (v: V | null) => void,
  ) => (
    <View style={{ gap: 8, marginTop: 12 }}>
      <Text variant="body" style={{ fontWeight: '700' }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[{ value: '' as const, label: t.company.empFilterAll }, ...options].map((o) => (
          <Pressable
            key={o.value}
            onPress={() => change((o.value || null) as V | null)}
            style={{
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor:
                (value ?? '') === o.value ? theme.color.brand : theme.color.brandSoft,
            }}
          >
            <Text
              style={{ color: (value ?? '') === o.value ? theme.color.onBrand : theme.color.brand }}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  const periodItems: OverflowMenuItem[] = (
    [
      ['daily', 'today-outline', t.company.attendanceDailyView],
      ['weekly', 'calendar-outline', t.company.attendanceWeeklyView],
      ['monthly', 'calendar-number-outline', t.company.attendanceMonthlyView],
    ] as const
  )
    .filter(([p]) => p !== period)
    .map(([p, icon, label]) => ({ icon, label, onPress: () => setPeriod(p) }));
  const leaveOf = (memberId: string) => {
    const on = leave.filter(
      (l) => l.memberId === memberId && l.startDay <= date && date <= l.endDay,
    );
    return on.some((l) => l.status === 'approved')
      ? ('approved' as const)
      : on.some((l) => l.status === 'pending')
        ? ('pending' as const)
        : null;
  };
  const markAll = async (status: 'present' | 'absent') => {
    // People on approved leave are locked, so a bulk mark leaves them alone.
    const targets = people.filter((p) => leaveOf(p.id) !== 'approved');
    const change = targets.filter((p) => marks.get(`${p.id}|${date}`)?.status !== status);
    const replacing = change.filter((p) => marks.has(`${p.id}|${date}`)).length;
    if (
      replacing &&
      !(await confirm({
        title: t.company.attendanceOverwriteTitle,
        body: fill(t.company.attendanceOverwriteBody, { n: String(replacing) }),
        confirmLabel:
          status === 'present' ? t.company.attendanceMarkAll : t.company.attendanceMarkAllAbsent,
      }))
    )
      return;
    for (const p of change) write(p.id, status, marks.get(`${p.id}|${date}`)?.note ?? null);
  };
  const pickPerson = access.people.find((p) => p.id === pickFor);
  const pickMark = pickFor ? marks.get(`${pickFor}|${date}`) : undefined;
  const choose = (status: AttendanceStatus | null) => {
    if (pickFor) write(pickFor, status, status ? (pickMark?.note ?? null) : null);
    setPickFor(null);
  };
  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicBody flush={embedded}>
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : access.canManage ? (
              <View style={{ gap: 14 }}>
                {embedded ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text variant="title" style={{ fontSize: 24, fontWeight: '800' }}>
                      {t.company.attendanceTitle}
                    </Text>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 2,
                        borderRadius: 12,
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{ color: theme.color.brand, fontWeight: '800' }}
                      >
                        {counts.present}/{access.people.length}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <AttendanceToolbar
                  dayLabel={
                    period === 'monthly'
                      ? new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(locale, {
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'UTC',
                        })
                      : labelDate
                  }
                  onDay={() => setDateOpen(true)}
                  query={search}
                  onQueryChange={setSearch}
                  onMenu={(a) => setMenuAnchor(a ?? 'open')}
                  menuLabel={t.company.attendanceMore}
                />
                {period === 'daily' ? (
                  <>
                    <StandardCard style={{ padding: 0, overflow: 'hidden' }}>
                      {people.map((person, index) => {
                        const mark = marks.get(`${person.id}|${date}`);
                        const lv = leaveOf(person.id);
                        return (
                          <AttendanceRow
                            key={person.id}
                            member={person}
                            name={displayName(person)}
                            ghost={isGhost(person)}
                            subtitle={person.employee_id ?? ''}
                            status={mark?.status}
                            leave={lv}
                            chip={mark?.status === 'half' ? t.company.attendanceHalfDay : null}
                            hasNote={!!mark?.note}
                            canEdit={!busy && date <= today}
                            labels={{
                              present: t.company.attendancePresent,
                              absent: t.company.attendanceAbsent,
                              onLeave: t.company.attendanceOnLeave,
                              leaveApplied: t.company.attendanceLeaveApplied,
                              leave: t.company.attendanceLeave,
                            }}
                            onMark={(status) => write(person.id, status, mark?.note ?? null)}
                            onOpen={() => setPickFor(person.id)}
                            divider={index < people.length - 1}
                          />
                        );
                      })}
                    </StandardCard>
                    <View
                      style={{
                        alignSelf: 'center',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 20,
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={18}
                        color={theme.color.brand}
                      />
                      <Text
                        variant="caption"
                        style={{ color: theme.color.brand, fontWeight: '700' }}
                      >
                        {t.company.attendanceAutoSaved}
                      </Text>
                    </View>
                  </>
                ) : (
                  <AttendanceReadOnly
                    period={period}
                    date={date}
                    days={days}
                    people={people}
                    marks={marks}
                    departments={departments}
                    locale={locale}
                  />
                )}
              </View>
            ) : access.isEmployee && access.me ? (
              <AttendanceReadOnly
                period="monthly"
                date={date}
                days={days}
                people={[access.me]}
                marks={marks}
                departments={departments}
                locale={locale}
              />
            ) : null}
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
          </ReadOnlyWhenSuspended>
        </ScenicBody>
      </ScrollView>
      <OverflowMenu
        visible={menuAnchor !== null}
        onClose={() => setMenuAnchor(null)}
        anchor={menuAnchor === 'open' ? null : menuAnchor}
        items={[
          {
            icon: 'checkmark-circle',
            label: t.company.attendanceMarkAll,
            disabled: busy || date > today || period !== 'daily',
            onPress: () => void markAll('present'),
          },
          {
            icon: 'close-circle',
            label: t.company.attendanceMarkAllAbsent,
            disabled: busy || date > today || period !== 'daily',
            onPress: () => void markAll('absent'),
          },
          {
            icon: 'options-outline',
            label: t.company.attendanceFilters,
            section: 'more',
            onPress: () => setFilterOpen(true),
          },
          ...periodItems.map((item) => ({ ...item, section: 'more' })),
          {
            icon: 'download-outline',
            label: t.company.exportAction,
            route: `/group/${id}/export`,
          },
        ]}
      />
      <Sheet visible={!!pickFor} onClose={() => setPickFor(null)} closeLabel={t.common.close}>
        <View style={{ padding: 16, gap: 8 }}>
          <Text variant="heading">{t.company.attendanceSetStatus}</Text>
          {pickPerson ? (
            <Text tone="muted" numberOfLines={1}>
              {displayName(pickPerson)}
            </Text>
          ) : null}
          {pickPerson ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {[
                departmentName(departments, pickPerson.department_id),
                plural(locale, taskCount.get(pickPerson.id) ?? 0, t.company.attendanceTasks),
                balances.get(pickPerson.id)?.owes
                  ? `↓ ${money(balances.get(pickPerson.id)!.owes)}`
                  : `↑ ${money(balances.get(pickPerson.id)?.advances ?? 0n)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {(['present', 'half', 'absent', null] as const).map((status) => {
            const on = (pickMark?.status ?? null) === status;
            const color =
              status === 'present'
                ? GREEN
                : status === 'half'
                  ? theme.color.warning
                  : status === 'absent'
                    ? RED
                    : theme.color.textMuted;
            return (
              <Pressable
                key={status ?? 'clear'}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                disabled={
                  busy || leaveOf(pickFor ?? '') === 'approved' || (status === null && !pickMark)
                }
                onPress={() => choose(status)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 48,
                  paddingHorizontal: 14,
                  borderRadius: 16,
                  backgroundColor: on ? `${color}22` : theme.color.surfaceMuted,
                  opacity: status === null && !pickMark ? 0.4 : 1,
                }}
              >
                <Ionicons
                  name={
                    status === 'present'
                      ? 'checkmark-circle'
                      : status === 'half'
                        ? 'contrast'
                        : status === 'absent'
                          ? 'remove-circle'
                          : 'close-circle-outline'
                  }
                  size={22}
                  color={color}
                />
                <Text style={{ fontWeight: '600', flex: 1 }}>
                  {status ? statusText(status) : t.company.attendanceClear}
                </Text>
                {on ? <Ionicons name="checkmark" size={18} color={color} /> : null}
              </Pressable>
            );
          })}
          {pickMark && date <= today && !busy ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNoteFor(pickFor);
                setPickFor(null);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
            >
              <Ionicons name="chatbox-outline" size={20} color={theme.color.brand} />
              <Text style={{ color: theme.color.brand, fontWeight: '600' }}>
                {t.company.attendanceNote}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push(`/group/${id}/company-statement?member=${pickFor}`);
              setPickFor(null);
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
          >
            <Ionicons name="document-text-outline" size={20} color={theme.color.brand} />
            <Text style={{ color: theme.color.brand, fontWeight: '600' }}>
              {t.company.viewStatement}
            </Text>
          </Pressable>
        </View>
      </Sheet>
      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} closeLabel={t.common.close}>
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 16 }}>
          <Text variant="heading">{t.company.attendanceFilters}</Text>
          {filterChips(
            t.company.attendanceDepartment,
            department,
            departments.map((d) => ({ value: d.id, label: d.name })),
            setDepartment,
          )}
          {filterChips(
            t.company.tabManagers,
            manager,
            company.members
              .filter((p) => p.role === 'manager' && !p.left_at)
              .map((p) => ({ value: p.id, label: displayName(p) })),
            setManager,
          )}
          {filterChips<StatusFilter>(
            t.company.attendanceStatus,
            statusFilter,
            [
              { value: 'present', label: t.company.attendancePresent },
              { value: 'half', label: t.company.attendanceHalfDay },
              { value: 'absent', label: t.company.attendanceAbsent },
              { value: 'unmarked', label: t.company.attendanceNotMarked },
            ],
            setStatusFilter,
          )}
          {filterChips(
            t.company.workSite,
            site,
            sites.map((p) => ({ value: p.id, label: p.name })),
            setSite,
          )}
        </ScrollView>
      </Sheet>
      <Sheet visible={dateOpen} onClose={() => setDateOpen(false)} closeLabel={t.common.close}>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={new Date(`${date}T12:00:00`)}
            maximumDate={new Date(`${today}T23:59:59`)}
            mode="date"
            display="inline"
            onChange={(_, d) => {
              if (d) setDate(d.toISOString().slice(0, 10));
              setDateOpen(false);
            }}
          />
        ) : (
          <DateTimePicker
            value={new Date(`${date}T12:00:00`)}
            maximumDate={new Date(`${today}T23:59:59`)}
            mode="date"
            onChange={(_, d) => {
              setDateOpen(false);
              if (d) setDate(d.toISOString().slice(0, 10));
            }}
          />
        )}
      </Sheet>
      <EditTextSheet
        visible={!!noteFor}
        title={t.company.attendanceNote}
        maxLength={200}
        saving={busy}
        error={error ? t.company.workSaveError : undefined}
        value={noteFor ? (marks.get(`${noteFor}|${date}`)?.note ?? '') : ''}
        onClose={() => setNoteFor(null)}
        onSave={(note) => {
          if (noteFor) {
            const mark = marks.get(`${noteFor}|${date}`);
            if (mark) {
              setError(false);
              save.mutate(
                { memberId: noteFor, day: date, status: mark.status, note: note || null },
                { onSuccess: () => setNoteFor(null), onError: () => setError(true) },
              );
            }
          }
        }}
      />
    </>
  );
}

function AttendanceReadOnly({
  period,
  date,
  days,
  people,
  marks,
  departments,
  locale,
}: {
  period: Period;
  date: string;
  days: string[];
  people: readonly import('@/data/types').MemberRow[];
  marks: ReadonlyMap<string, import('@/data/companyWorkday').MirrorAttendance>;
  departments: readonly import('@/data/companyDepartments').CompanyDepartment[];
  locale: string;
}) {
  const theme = useTheme();
  const month = date.slice(0, 7);
  const rows = period === 'weekly' ? days : [];
  return (
    <StandardCard style={{ gap: 10 }}>
      {people.map((person, index) => {
        const title = displayName(person);
        if (period === 'weekly')
          return (
            <View key={person.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{title}</Text>
                <Text variant="micro" tone="muted">
                  {departmentName(departments, person.department_id) ?? person.employee_id ?? ''}
                </Text>
              </View>
              {rows.map((day) => (
                <View key={day} style={{ width: 22, alignItems: 'center' }}>
                  <Text variant="micro" tone="muted">
                    {new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
                      weekday: 'narrow',
                      timeZone: 'UTC',
                    })}
                  </Text>
                  <Text style={{ color: theme.color.brand }}>
                    {attendanceStatusLetter(marks.get(`${person.id}|${day}`)?.status)}
                  </Text>
                </View>
              ))}
              <Text>{rows.reduce((n, d) => n + (marks.has(`${person.id}|${d}`) ? 1 : 0), 0)}</Text>
            </View>
          );
        const counts = { present: 0, half: 0, absent: 0 };
        for (const [key, m] of marks)
          if (key.startsWith(`${person.id}|${month}-`)) counts[m.status]++;
        return (
          <View
            key={person.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 8,
              borderBottomWidth: index < people.length - 1 ? 1 : 0,
              borderColor: theme.color.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text>{title}</Text>
              <Text variant="micro" tone="muted">
                {departmentName(departments, person.department_id) ?? person.employee_id ?? ''}
              </Text>
            </View>
            <Text>
              {counts.present} P · {counts.half} ½ · {counts.absent} A
            </Text>
          </View>
        );
      })}
    </StandardCard>
  );
}
