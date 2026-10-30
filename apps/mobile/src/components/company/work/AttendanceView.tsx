import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { dashboardStats } from '@waves/core';
import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { EditTextSheet } from '@/components/EditTextSheet';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { Sheet, Text, useTheme } from '@waves/ui';
import { ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
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
import { useDepartments, departmentName } from '@/data/companyDepartments';
import { useGroup } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { plural, fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import {
  attendanceStatusLetter,
  dayCounts,
  markAllTargets,
  riseIsGood,
  signedDelta,
  stepIso,
  weekDays,
} from '@/lib/companyAttendance';
import { AttendanceRow, GREEN, RED } from './AttendanceRow';

type Period = 'daily' | 'weekly' | 'monthly';
type StatusFilter = AttendanceStatus | 'unmarked';
export default function AttendanceView({
  groupId: id,
  segment,
  onSwitch,
}: {
  groupId: string;
  /** The Attendance | Daily work switch. With `onSwitch`, this view draws its own header. */
  segment?: ReactNode;
  onSwitch?: () => void;
}) {
  const access = useWorkdayAccess(id),
    marks = useAttendance(id),
    save = useSetAttendance(id),
    tasks = useWorkTasks(id);
  const company = useCompanyEntries(id),
    sites = useCompanyProjects(id),
    siteMembers = useCompanyProjectMembers(id),
    departments = useDepartments(id),
    group = useGroup(id).group.data;
  const { t, locale } = useStrings(),
    theme = useTheme(),
    clearance = useBottomClearance(),
    money = useMoney(company.currency);
  const today = todayIso();
  const [period, setPeriod] = useState<Period>('daily'),
    [date, setDate] = useState(today);
  const [search, setSearch] = useState(''),
    [filterOpen, setFilterOpen] = useState(false),
    [dateOpen, setDateOpen] = useState(false),
    [menuOpen, setMenuOpen] = useState(false);
  const [department, setDepartment] = useState<string | null>(null),
    [manager, setManager] = useState<string | null>(null),
    [site, setSite] = useState<string | null>(null),
    [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
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
          (!statusFilter || (statusFilter === 'unmarked' ? !mark : mark === statusFilter))
        );
      }),
    [access.people, search, department, manager, site, siteMembers, statusFilter, marks, date],
  );
  // The stat card counts everyone the viewer may mark; only the list below follows the filters.
  const counts = dayCounts(access.people, marks, date);
  const before = dayCounts(access.people, marks, stepIso(date, -1, 'day'));
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
  const unit = period === 'monthly' ? 'month' : 'day';
  const step = (dir: 1 | -1) => setDate(stepIso(date, dir * (period === 'weekly' ? 7 : 1), unit));
  const filtersOn = !!(department || manager || site || statusFilter);
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
  const circle = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surface,
      }}
    >
      <Ionicons name={icon} size={20} color={theme.color.brand} />
    </Pressable>
  );
  const header =
    onSwitch && access.canManage ? (
      <ScenicHeader
        wash
        titleAlign="start"
        title={t.company.attendanceTitle}
        titleHint={t.company.workTitle}
        onTitlePress={onSwitch}
        subtitle={fill(plural(locale, access.people.length, t.company.attendanceSubtitle), {
          company: group?.name ?? '',
        })}
        action={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {circle('calendar-outline', t.company.attendancePickDate, () => setDateOpen(true))}
            {circle('ellipsis-horizontal', t.company.attendanceMore, () => setMenuOpen(true))}
          </View>
        }
      />
    ) : null;
  const periodItems: OverflowMenuItem[] = (
    [
      ['daily', 'today-outline', t.company.attendanceDailyView],
      ['weekly', 'calendar-outline', t.company.attendanceWeeklyView],
      ['monthly', 'calendar-number-outline', t.company.attendanceMonthlyView],
    ] as const
  )
    .filter(([p]) => p !== period)
    .map(([p, icon, label]) => ({ icon, label, onPress: () => setPeriod(p) }));
  const delta = (kind: 'present' | 'half' | 'absent' | 'total', now: number, was: number) => {
    const d = now - was,
      good = riseIsGood(kind);
    const color = d === 0 || good === null ? theme.color.textMuted : d > 0 === good ? GREEN : RED;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
        {d !== 0 && good !== null ? (
          <Ionicons name={d > 0 ? 'arrow-up' : 'arrow-down'} size={11} color={color} />
        ) : null}
        <Text variant="micro" numberOfLines={1} style={{ color }}>
          {fill(t.company.attendanceVsYesterday, { delta: signedDelta(d) })}
        </Text>
      </View>
    );
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
        {header}
        <ScenicBody>
          {segment}
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : access.canManage ? (
              <View style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      period === 'monthly'
                        ? t.company.attendancePreviousMonth
                        : t.company.workPreviousDay
                    }
                    disabled={date <= '2000-01-01'}
                    onPress={() => step(-1)}
                    style={{
                      width: 36,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: theme.color.surface,
                    }}
                  >
                    <Ionicons name="chevron-back" size={18} color={theme.color.brand} />
                  </Pressable>
                  <Pressable
                    onPress={() => setDateOpen(true)}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      paddingHorizontal: 8,
                      borderRadius: 22,
                      backgroundColor: theme.color.surface,
                    }}
                  >
                    <Ionicons name="calendar-outline" size={18} color={theme.color.brand} />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      style={{ flexShrink: 1, fontWeight: '600' }}
                    >
                      {period === 'monthly'
                        ? new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(locale, {
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })
                        : labelDate}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={theme.color.brand} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      period === 'monthly' ? t.company.attendanceNextMonth : t.company.workNextDay
                    }
                    disabled={date >= today}
                    onPress={() => step(1)}
                    style={{
                      width: 36,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: date >= today ? 0.4 : 1,
                      backgroundColor: theme.color.surface,
                    }}
                  >
                    <Ionicons name="chevron-forward" size={18} color={theme.color.brand} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setFilterOpen(true)}
                    style={{
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 10,
                      borderRadius: 22,
                      backgroundColor: filtersOn ? theme.color.brandSoft : theme.color.surface,
                    }}
                  >
                    <Ionicons name="options-outline" size={18} color={theme.color.brand} />
                    <Text
                      numberOfLines={1}
                      style={{ color: theme.color.brand, fontWeight: '600', maxWidth: 88 }}
                    >
                      {t.company.attendanceFilters}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={theme.color.brand} />
                  </Pressable>
                </View>
                {period === 'daily' ? (
                  <>
                    <StandardCard
                      style={{
                        flexDirection: 'row',
                        paddingVertical: 14,
                        paddingHorizontal: 4,
                      }}
                    >
                      {(
                        [
                          [
                            'present',
                            counts.present,
                            before.present,
                            t.company.attendancePresent,
                            'person-circle',
                            GREEN,
                          ],
                          [
                            'half',
                            counts.half,
                            before.half,
                            t.company.attendanceHalfDay,
                            'contrast',
                            theme.color.warning,
                          ],
                          [
                            'absent',
                            counts.absent,
                            before.absent,
                            t.company.attendanceAbsent,
                            'remove-circle',
                            RED,
                          ],
                          [
                            'total',
                            access.people.length,
                            access.people.length,
                            t.company.attendanceTotal,
                            'people-circle',
                            theme.color.brand,
                          ],
                        ] as const
                      ).map(([kind, now, was, label, icon, color], i) => (
                        <View
                          key={kind}
                          style={{
                            flex: 1,
                            alignItems: 'center',
                            gap: 2,
                            borderStartWidth: i ? 1 : 0,
                            borderColor: theme.color.border,
                          }}
                        >
                          <Ionicons name={icon} size={24} color={color} />
                          <Text variant="heading">{now}</Text>
                          <Text variant="caption" tone="muted" numberOfLines={1}>
                            {label}
                          </Text>
                          {delta(kind, now, was)}
                        </View>
                      ))}
                    </StandardCard>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <View
                        style={{
                          flex: 1,
                          minHeight: 44,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 22,
                          backgroundColor: theme.color.surface,
                          paddingHorizontal: 12,
                        }}
                      >
                        <Ionicons name="search" size={18} color={theme.color.textMuted} />
                        <TextInput
                          value={search}
                          onChangeText={setSearch}
                          placeholder={t.company.attendanceSearch}
                          placeholderTextColor={theme.color.textMuted}
                          style={{ flex: 1, color: theme.color.text }}
                        />
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        disabled={
                          busy || markAllTargets(people, marks, date).length === 0 || date > today
                        }
                        onPress={() =>
                          markAllTargets(people, marks, date).forEach((memberId) =>
                            write(memberId, 'present', null),
                          )
                        }
                        style={{
                          minHeight: 44,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          paddingHorizontal: 12,
                          borderRadius: 22,
                          backgroundColor: theme.color.brand,
                          opacity:
                            busy || markAllTargets(people, marks, date).length === 0 || date > today
                              ? 0.5
                              : 1,
                        }}
                      >
                        <Ionicons name="checkmark" size={18} color={theme.color.onBrand} />
                        <Text
                          numberOfLines={2}
                          style={{
                            color: theme.color.onBrand,
                            fontWeight: '700',
                            maxWidth: 96,
                            fontSize: 13,
                          }}
                        >
                          {t.company.attendanceMarkAll}
                        </Text>
                      </Pressable>
                    </View>
                    <StandardCard style={{ padding: 0, overflow: 'hidden' }}>
                      {people.map((person, index) => {
                        const mark = marks.get(`${person.id}|${date}`);
                        const title = displayName(person);
                        const bal = balances.get(person.id) ?? { owes: 0n, advances: 0n };
                        const dept = departmentName(departments, person.department_id);
                        return (
                          <AttendanceRow
                            key={person.id}
                            member={person}
                            name={title}
                            ghost={isGhost(person)}
                            subtitle={[dept, person.employee_id].filter(Boolean).join(' · ')}
                            chip={dept ?? null}
                            status={mark?.status}
                            statusLabel={statusText(mark?.status)}
                            tasksLabel={plural(
                              locale,
                              taskCount.get(person.id) ?? 0,
                              t.company.attendanceTasks,
                            )}
                            balance={
                              bal.advances > 0n
                                ? { kind: 'owesCompany', text: money(bal.advances) }
                                : bal.owes > 0n
                                  ? { kind: 'companyOwes', text: money(bal.owes) }
                                  : { kind: 'settled', text: money(0n) }
                            }
                            canEdit={!busy && date <= today}
                            hasNote={!!mark?.note}
                            noteLabel={t.company.attendanceNote}
                            menuLabel={t.company.attendanceMore}
                            menuItems={[
                              {
                                icon: 'document-text-outline',
                                label: t.company.viewStatement,
                                route: `/group/${id}/company-statement?member=${person.id}`,
                              },
                              ...(mark && date <= today
                                ? [
                                    {
                                      icon: 'chatbox-outline',
                                      label: t.company.attendanceNote,
                                      onPress: () => setNoteFor(person.id),
                                    } as OverflowMenuItem,
                                  ]
                                : []),
                            ]}
                            onStatus={() => setPickFor(person.id)}
                            onNote={() => setNoteFor(person.id)}
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
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          ...periodItems,
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
                disabled={busy || (status === null && !pickMark)}
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
