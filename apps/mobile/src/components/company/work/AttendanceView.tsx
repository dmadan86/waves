import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { dashboardStats } from '@waves/core';
import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { PersonAvatar } from '@/components/PersonAvatar';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { Button, Sheet, Text, useTheme } from '@waves/ui';
import { ScenicBody, StandardCard } from '@/components/standard';
import { useMoney } from '@/components/company/dashboard/parts';
import {
  useAttendance,
  useAttendanceSaveState,
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
import { useCalendar, useCalendarAccess } from '@/data/companyCalendar';
import { HolidayFormSheet } from '@/components/company/CompanyCalendarSheets';
import { useDepartments, departmentName } from '@/data/companyDepartments';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { plural, fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { router } from '@/lib/navigation';
import type { MenuAnchor } from '@/components/SortMenu';
import { matchesStatus, weekDays } from '@/lib/companyAttendance';
import { AMBER, AttendanceRow, GREEN, RED } from './AttendanceRow';
import { withAlpha } from '@/components/company/dashboard/overviewKit';
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
    saveState = useAttendanceSaveState(id),
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
  const { leave, holidays } = useCalendar(id);
  const isOwner = useCalendarAccess(id).isOwner;
  const [holidayOpen, setHolidayOpen] = useState(false);
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
  const [pickFor, setPickFor] = useState<string | null>(null),
    [draftStatus, setDraftStatus] = useState<AttendanceStatus | null>(null),
    [draftNote, setDraftNote] = useState(''),
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
  const write = (
    memberId: string,
    status: AttendanceStatus | null,
    note: string | null,
    onSuccess?: () => void,
  ) => {
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
    save.mutate(
      { memberId, day: date, status, note },
      { onSuccess, onError: () => setError(true) },
    );
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
  // Android's picker is its own dialog; inside a Sheet it left an empty sheet behind it.
  const openDate = () =>
    Platform.OS === 'android'
      ? DateTimePickerAndroid.open({
          value: new Date(`${date}T12:00:00`),
          maximumDate: new Date(`${today}T23:59:59`),
          mode: 'date',
          onChange: (event, d) => {
            if (event.type === 'set' && d) setDate(d.toISOString().slice(0, 10));
          },
        })
      : setDateOpen(true);
  const holidayOn = holidays.find((h) => h.startDay <= date && date <= h.endDay);
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
  // Staged: the tiles and note only change the draft; Save writes it (one write, status and note together).
  const openPick = (memberId: string) => {
    const m = marks.get(`${memberId}|${date}`);
    setDraftStatus(m?.status ?? null);
    setDraftNote(m?.note ?? '');
    setPickFor(memberId);
  };
  const locked = !!pickFor && (date > today || leaveOf(pickFor) === 'approved');
  const changed =
    draftStatus !== (pickMark?.status ?? null) ||
    (!!draftStatus && draftNote.trim() !== (pickMark?.note ?? ''));
  const saveDraft = () => {
    // Stay open on failure so the draft survives for a retry.
    if (pickFor)
      write(pickFor, draftStatus, draftStatus ? draftNote.trim() || null : null, () =>
        setPickFor(null),
      );
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
                  onDay={openDate}
                  saveState={saveState}
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
                            onOpen={() => openPick(person.id)}
                            divider={index < people.length - 1}
                          />
                        );
                      })}
                    </StandardCard>
                  </>
                ) : (
                  <AttendanceReadOnly
                    period={period}
                    date={date}
                    days={days}
                    people={people}
                    marks={marks}
                    leave={leave}
                    holidays={holidays}
                    departments={departments}
                    locale={locale}
                    onDate={(d) => setDate(d > today ? today : d)}
                    groupId={id}
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
                leave={leave}
                holidays={holidays}
                departments={departments}
                locale={locale}
                onDate={(d) => setDate(d > today ? today : d)}
                groupId={id}
              />
            ) : null}
            {error ? <Text tone="negative">{t.company.workSaveError}</Text> : null}
          </ReadOnlyWhenSuspended>
        </ScenicBody>
      </ScrollView>
      <HolidayFormSheet
        key={`${date}|${holidayOn?.id ?? ''}`}
        groupId={id}
        visible={holidayOpen}
        onClose={() => setHolidayOpen(false)}
        day={holidayOn ? undefined : date}
        holiday={holidayOn}
      />
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
          ...(isOwner
            ? [
                {
                  icon: 'sunny-outline' as const,
                  label: holidayOn
                    ? fill(t.company.attendanceHolidayEdit, { name: holidayOn.name })
                    : t.company.attendanceMarkHoliday,
                  onPress: () => setHolidayOpen(true),
                },
              ]
            : []),
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
        <View style={{ padding: 16, gap: 12 }}>
          <Text variant="heading">{t.company.attendanceSetStatus}</Text>
          {pickPerson ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <PersonAvatar
                member={pickPerson}
                name={displayName(pickPerson)}
                ghost={isGhost(pickPerson)}
                size={40}
              />
              <View
                style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700' }} numberOfLines={1}>
                  {displayName(pickPerson)}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {[
                    plural(locale, taskCount.get(pickPerson.id) ?? 0, t.company.attendanceTasks),
                    balances.get(pickPerson.id)?.owes
                      ? `↓ ${money(balances.get(pickPerson.id)!.owes)}`
                      : `↑ ${money(balances.get(pickPerson.id)?.advances ?? 0n)}`,
                  ].join(' · ')}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 16,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Ionicons name="calendar-outline" size={14} color={theme.color.brand} />
                <Text variant="micro" style={{ color: theme.color.brand, fontWeight: '600' }}>
                  {labelDate}
                </Text>
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['present', 'half', 'absent', null] as const).map((status) => {
              const on = draftStatus === status;
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
                  disabled={locked}
                  onPress={() => setDraftStatus(status)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 12,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: on ? color : 'transparent',
                    backgroundColor: `${color}${on ? '26' : '14'}`,
                    opacity: locked ? 0.5 : 1,
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
                    size={26}
                    color={color}
                  />
                  <Text variant="caption" style={{ fontWeight: '600' }} numberOfLines={1}>
                    {status ? statusText(status) : t.company.attendanceClear}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.color.border,
              opacity: draftStatus && !locked ? 1 : 0.5,
            }}
          >
            <Ionicons name="chatbox-outline" size={20} color={theme.color.textMuted} />
            <TextInput
              value={draftNote}
              onChangeText={setDraftNote}
              editable={!!draftStatus && !locked}
              maxLength={200}
              placeholder={t.company.attendanceNotePlaceholder}
              placeholderTextColor={theme.color.textFaint}
              accessibilityLabel={t.company.attendanceNote}
              style={{ flex: 1, minHeight: 44, color: theme.color.text }}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push(`/group/${id}/company-statement?member=${pickFor}`);
              setPickFor(null);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 14,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="document-text-outline" size={20} color={theme.color.brand} />
            <Text style={{ fontWeight: '600', flex: 1 }}>{t.company.viewStatement}</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.color.textMuted} />
          </Pressable>
          <Button
            label={t.common.save}
            icon="checkmark"
            disabled={locked || busy || !changed}
            onPress={saveDraft}
          />
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
      {Platform.OS === 'ios' ? (
        <Sheet visible={dateOpen} onClose={() => setDateOpen(false)} closeLabel={t.common.close}>
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
        </Sheet>
      ) : null}
    </>
  );
}

type LeaveSpan = { memberId: string; status: string; startDay: string; endDay: string };

/** Week (7 cells) or month (every day, scrolls sideways) grid: member on the left, one cell per day. */
function AttendanceReadOnly({
  period,
  date,
  days,
  people,
  marks,
  leave,
  holidays,
  departments,
  locale,
  onDate,
  groupId,
}: {
  groupId: string;
  period: Period;
  date: string;
  days: string[];
  people: readonly import('@/data/types').MemberRow[];
  marks: ReadonlyMap<string, import('@/data/companyWorkday').MirrorAttendance>;
  leave: readonly LeaveSpan[];
  holidays: readonly { startDay: string; endDay: string; name: string }[];
  departments: readonly import('@/data/companyDepartments').CompanyDepartment[];
  locale: string;
  onDate: (iso: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const today = todayIso();
  const month = date.slice(0, 7);
  const weekly = period === 'weekly';
  const cols = weekly ? days : monthDays(month);
  const show = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
  const title = weekly
    ? `${show(days[0]!, { month: 'short', day: 'numeric' })} – ${show(days[6]!, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : show(`${month}-01`, { month: 'long', year: 'numeric' });
  const prev = weekly ? shiftIso(days[0]!, -7) : shiftMonth(month, -1);
  const next = weekly ? shiftIso(days[0]!, 7) : shiftMonth(month, 1);
  const onLeave = (memberId: string, day: string) =>
    leave.some(
      (l) =>
        l.memberId === memberId && l.status === 'approved' && l.startDay <= day && day <= l.endDay,
    );
  const isHoliday = (day: string) => holidays.some((h) => h.startDay <= day && day <= h.endDay);
  const ROW = 48,
    HEAD = 40,
    NAME = 120,
    CELL = 30;
  const cell = (memberId: string, day: string) => {
    const status = marks.get(`${memberId}|${day}`)?.status;
    const [icon, ink] =
      status === 'present'
        ? (['checkmark', GREEN] as const)
        : status === 'absent'
          ? (['close', RED] as const)
          : status === 'half'
            ? ([null, AMBER] as const)
            : onLeave(memberId, day)
              ? (['umbrella-outline', LEAVE] as const)
              : isHoliday(day)
                ? (['sunny-outline', HOLIDAY] as const)
                : ([null, null] as const);
    return (
      <View
        key={day}
        style={{
          ...(weekly ? { flex: 1 } : { width: CELL }),
          height: 34,
          marginHorizontal: 2,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: ink ? withAlpha(ink, 0.12) : theme.color.surfaceMuted,
        }}
      >
        {icon ? (
          <Ionicons name={icon} size={16} color={ink} />
        ) : status === 'half' ? (
          <Text variant="caption" style={{ color: AMBER, fontWeight: '700' }}>
            ½
          </Text>
        ) : null}
      </View>
    );
  };
  const grid = (
    <View>
      <View style={{ flexDirection: 'row', height: HEAD, alignItems: 'center' }}>
        {cols.map((day) => (
          <View
            key={day}
            style={{
              ...(weekly ? { flex: 1 } : { width: CELL }),
              marginHorizontal: 2,
              alignItems: 'center',
            }}
          >
            <Text variant="micro" tone="muted">
              {show(day, { weekday: weekly ? 'short' : 'narrow' })}
            </Text>
            <Text
              variant="micro"
              style={{
                fontWeight: '700',
                color: day === today ? theme.color.brand : theme.color.text,
              }}
            >
              {Number(day.slice(8))}
            </Text>
          </View>
        ))}
      </View>
      {people.map((person) => (
        <View key={person.id} style={{ flexDirection: 'row', height: ROW, alignItems: 'center' }}>
          {cols.map((day) => cell(person.id, day))}
        </View>
      ))}
    </View>
  );
  const arrow = (to: string, icon: 'chevron-back' | 'chevron-forward', label: string) => {
    const off = to > today;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: off }}
        disabled={off}
        onPress={() => onDate(to)}
        hitSlop={8}
        style={{ padding: 4, opacity: off ? 0.3 : 1 }}
      >
        <Ionicons name={icon} size={20} color={theme.color.text} />
      </Pressable>
    );
  };
  const legend: [string | null, string, string][] = [
    ['checkmark', GREEN, t.company.attendancePresent],
    [null, AMBER, t.company.attendanceHalfDay],
    ['umbrella-outline', LEAVE, t.company.attendanceLeave],
    ['sunny-outline', HOLIDAY, t.calendar.addHoliday],
    ['close', RED, t.company.attendanceAbsent],
  ];
  return (
    <StandardCard style={{ padding: 0, overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          paddingVertical: 10,
        }}
      >
        {arrow(prev, 'chevron-back', t.company.attendancePrevious)}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="calendar-outline" size={16} color={theme.color.brand} />
          <Text variant="caption" style={{ fontWeight: '700' }}>
            {title}
          </Text>
        </View>
        {arrow(next, 'chevron-forward', t.company.attendanceNext)}
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
        <View style={{ width: NAME }}>
          <View style={{ height: HEAD, justifyContent: 'center', paddingStart: 4 }}>
            <Text variant="micro" tone="muted" style={{ fontWeight: '600' }}>
              {t.company.attendanceMember}
            </Text>
          </View>
          {people.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              accessibilityLabel={displayName(person)}
              onPress={() => router.push(`/group/${groupId}/company-statement?member=${person.id}`)}
              style={({ pressed }) => ({
                height: ROW,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <PersonAvatar
                member={person}
                name={displayName(person)}
                ghost={isGhost(person)}
                size={28}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
                  {displayName(person)}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {person.employee_id ?? departmentName(departments, person.department_id) ?? ''}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        {weekly ? (
          <View style={{ flex: 1 }}>{grid}</View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            {grid}
          </ScrollView>
        )}
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderTopWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        {legend.map(([icon, ink, label]) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {icon ? (
              <Ionicons name={icon as 'close'} size={14} color={ink} />
            ) : (
              <Text variant="micro" style={{ color: ink, fontWeight: '700' }}>
                ½
              </Text>
            )}
            <Text variant="micro" tone="muted">
              {label}
            </Text>
          </View>
        ))}
      </View>
    </StandardCard>
  );
}

const LEAVE = '#EA580C';
const HOLIDAY = '#2563EB';

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the month `by` months from `month` (yyyy-mm). */
function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
}

function monthDays(month: string): string[] {
  const first = new Date(`${month}-01T00:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
