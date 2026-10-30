import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { ReadOnlyWhenSuspended } from '@/components/company/SuspendedBanner';
import { EditTextSheet } from '@/components/EditTextSheet';
import { PersonAvatar } from '@/components/PersonAvatar';
import { Button, Sheet, Text, useTheme } from '@waves/ui';
import { ScenicBody, SegmentedPills, StandardCard } from '@/components/standard';
import {
  useAttendance,
  useSetAttendance,
  useWorkdayAccess,
  type AttendanceStatus,
} from '@/data/companyWorkday';
import {
  useCompanyEntries,
  useCompanyProjects,
  useCompanyProjectMembers,
} from '@/data/companyEntries';
import { useDepartments, departmentName } from '@/data/companyDepartments';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import {
  attendanceCounts,
  attendanceStatusLetter,
  markAllTargets,
  stepIso,
  weekDays,
} from '@/lib/companyAttendance';

type Period = 'daily' | 'weekly' | 'monthly';
export default function AttendanceView({ groupId: id }: { groupId: string }) {
  const access = useWorkdayAccess(id),
    marks = useAttendance(id),
    save = useSetAttendance(id);
  const company = useCompanyEntries(id),
    sites = useCompanyProjects(id),
    siteMembers = useCompanyProjectMembers(id),
    departments = useDepartments(id);
  const { t, locale } = useStrings(),
    theme = useTheme(),
    clearance = useBottomClearance();
  const today = todayIso();
  const [period, setPeriod] = useState<Period>('daily'),
    [date, setDate] = useState(today);
  const [search, setSearch] = useState(''),
    [filterOpen, setFilterOpen] = useState(false),
    [dateOpen, setDateOpen] = useState(false);
  const [department, setDepartment] = useState<string | null>(null),
    [manager, setManager] = useState<string | null>(null),
    [site, setSite] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null),
    [error, setError] = useState(false);
  const busy = save.isPending;
  const people = useMemo(
    () =>
      access.people.filter((p) => {
        const q = search.trim().toLowerCase();
        return (
          (!q ||
            displayName(p).toLowerCase().includes(q) ||
            (p.employee_id ?? '').toLowerCase().includes(q)) &&
          (!department || p.department_id === department) &&
          (!manager || p.manager_id === manager) &&
          (!site || (siteMembers.get(site) ?? []).includes(p.id))
        );
      }),
    [access.people, search, department, manager, site, siteMembers],
  );
  const dayRows = people
    .map((p) => marks.get(`${p.id}|${date}`))
    .filter((v): v is NonNullable<typeof v> => !!v);
  const counts = attendanceCounts(dayRows);
  const write = (memberId: string, status: AttendanceStatus | null, note: string | null) => {
    if (
      !access.enabled ||
      !access.canManage ||
      busy ||
      date > today ||
      !people.some((p) => p.id === memberId)
    )
      return;
    setError(false);
    save.mutate({ memberId, day: date, status, note }, { onError: () => setError(true) });
  };
  const labelDate = new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const days = weekDays(date);
  const filtersOn = !!(department || manager || site);
  const filterChips = (
    title: string,
    value: string | null,
    options: { value: string; label: string }[],
    change: (v: string | null) => void,
  ) => (
    <View style={{ gap: 8, marginTop: 12 }}>
      <Text variant="body" style={{ fontWeight: '700' }}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[{ value: '', label: t.company.empFilterAll }, ...options].map((o) => (
          <Pressable
            key={o.value}
            onPress={() => change(o.value || null)}
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
  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicBody>
          <ReadOnlyWhenSuspended groupId={id}>
            {!access.enabled ? (
              <Text tone="muted">{t.company.attendanceEmpty}</Text>
            ) : access.canManage ? (
              <View style={{ gap: 14 }}>
                <SegmentedPills
                  options={[
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                  ]}
                  value={period}
                  onChange={(v) => setPeriod(v as Period)}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Button
                    label="‹"
                    variant="secondary"
                    disabled={date <= '2000-01-01'}
                    onPress={() =>
                      setDate(stepIso(date, -1, period === 'monthly' ? 'month' : 'day'))
                    }
                  />
                  <Pressable
                    onPress={() => setDateOpen(true)}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: 13,
                      borderRadius: 24,
                      backgroundColor: theme.color.surface,
                    }}
                  >
                    <Ionicons name="calendar-outline" size={20} color={theme.color.brand} />
                    <Text>
                      {period === 'monthly'
                        ? new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(locale, {
                            month: 'long',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })
                        : labelDate}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={theme.color.brand} />
                  </Pressable>
                  <Button
                    label="›"
                    variant="secondary"
                    disabled={date >= today}
                    onPress={() =>
                      setDate(stepIso(date, 1, period === 'monthly' ? 'month' : 'day'))
                    }
                  />
                  <Button
                    label={`${filtersOn ? '• ' : ''}${t.company.workFilter}`}
                    variant="secondary"
                    onPress={() => setFilterOpen(true)}
                  />
                </View>
                {period === 'daily' ? (
                  <>
                    <StandardCard
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-around',
                        paddingVertical: 14,
                      }}
                    >
                      {[
                        [
                          counts.present,
                          t.company.attendancePresent,
                          'person',
                          theme.color.positive,
                        ],
                        [counts.half, t.company.attendanceHalf, 'contrast', theme.color.warning],
                        [
                          counts.absent,
                          t.company.attendanceAbsent,
                          'remove-circle',
                          theme.color.negative,
                        ],
                        [people.length, 'Total', 'people', theme.color.brand],
                      ].map(([n, l, i, c]) => (
                        <View key={String(l)} style={{ alignItems: 'center', gap: 3 }}>
                          <Ionicons name={i as never} size={19} color={c as string} />
                          <Text variant="heading">{n}</Text>
                          <Text variant="caption" tone="muted">
                            {l}
                          </Text>
                        </View>
                      ))}
                    </StandardCard>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 24,
                          backgroundColor: theme.color.surface,
                          paddingHorizontal: 14,
                        }}
                      >
                        <Ionicons name="search" size={20} color={theme.color.textMuted} />
                        <TextInput
                          value={search}
                          onChangeText={setSearch}
                          placeholder="Search employees..."
                          placeholderTextColor={theme.color.textMuted}
                          style={{ flex: 1, color: theme.color.text }}
                        />
                      </View>
                      <Button
                        label="✓ Mark all present"
                        disabled={
                          busy || markAllTargets(people, marks, date).length === 0 || date > today
                        }
                        onPress={() =>
                          markAllTargets(people, marks, date).forEach((memberId) =>
                            write(memberId, 'present', null),
                          )
                        }
                      />
                    </View>
                    <StandardCard style={{ padding: 0, overflow: 'hidden' }}>
                      {people.map((person, index) => {
                        const mark = marks.get(`${person.id}|${date}`);
                        const title = displayName(person);
                        return (
                          <View
                            key={person.id}
                            style={{
                              padding: 12,
                              borderBottomWidth: index < people.length - 1 ? 1 : 0,
                              borderColor: theme.color.border,
                              gap: 8,
                            }}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                              <PersonAvatar
                                member={person}
                                name={title}
                                ghost={isGhost(person)}
                                size={42}
                              />
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: '700' }}>{title}</Text>
                                <Text variant="caption" tone="muted">
                                  {departmentName(departments, person.department_id) ??
                                    person.employee_id ??
                                    ''}
                                </Text>
                              </View>
                              <Pressable
                                disabled={!mark || busy}
                                onPress={() => setNoteFor(person.id)}
                              >
                                <Ionicons
                                  name="chatbox-outline"
                                  size={22}
                                  color={theme.color.textMuted}
                                />
                              </Pressable>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6, marginLeft: 50 }}>
                              {(['present', 'half', 'absent'] as const).map((status) => {
                                const selected = mark?.status === status;
                                const text =
                                  status === 'present'
                                    ? t.company.attendancePresent
                                    : status === 'half'
                                      ? t.company.attendanceHalf
                                      : t.company.attendanceAbsent;
                                return (
                                  <Pressable
                                    key={status}
                                    disabled={busy || date > today}
                                    onPress={() =>
                                      write(person.id, selected ? null : status, mark?.note ?? null)
                                    }
                                    style={{
                                      flex: 1,
                                      alignItems: 'center',
                                      paddingVertical: 9,
                                      borderRadius: 16,
                                      backgroundColor: selected
                                        ? theme.color.brand
                                        : theme.color.brandSoft,
                                    }}
                                  >
                                    <Text
                                      numberOfLines={1}
                                      style={{
                                        fontSize: 12,
                                        color: selected ? theme.color.onBrand : theme.color.text,
                                      }}
                                    >
                                      {text}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
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
      <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} closeLabel={t.common.close}>
        <View style={{ padding: 16 }}>
          <Text variant="heading">{t.company.workFilter}</Text>
          {filterChips(
            'Department',
            department,
            departments.map((d) => ({ value: d.id, label: d.name })),
            setDepartment,
          )}
          {filterChips(
            t.company.tabManagers,
            manager,
            company.members
              .filter((p) => p.role === 'manager')
              .map((p) => ({ value: p.id, label: displayName(p) })),
            setManager,
          )}
          {filterChips(
            t.company.workSite,
            site,
            sites.map((p) => ({ value: p.id, label: p.name })),
            setSite,
          )}
        </View>
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
