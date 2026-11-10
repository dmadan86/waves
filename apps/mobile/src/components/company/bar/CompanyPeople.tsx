/**
 * People (the Team tab's first segment; TeamScreen draws the header): one compact card per person.
 * Default list = employed employees by name; the sort pop-up toggles name sort and admins (managers and
 * owners, within the viewer's visible set). Not employed is a mode set from the header menu. Every per-person number (today's
 * mark, open tasks, balance) is computed once per render into a map, never per row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Text, iconSize, useTheme } from '@waves/ui';

import { RolePill } from '@/components/company/dashboard/parts';
import { withAlpha } from '@/components/company/dashboard/overviewKit';
import { PersonAvatar } from '@/components/PersonAvatar';
import { PersonCard, type PersonStatus } from '@/components/company/bar/PersonCard';
import { OverflowMenu } from '@/components/OverflowMenu';
import { TwoStepPeople } from '@/components/company/twoStep/TwoStepPeople';
import type { MenuAnchor } from '@/components/SortMenu';
import { useCompanyEntries } from '@/data/companyEntries';
import { useActiveToday } from '@/data/companyOverview';
import {
  DEFAULT_PEOPLE_VIEW,
  attendanceToday,
  balancesByMember,
  listPeople,
  hierarchyRows,
  managerBalances,
  openTasksToday,
  wholeMoney,
  type Balance,
  type PeopleRow,
  type PeopleView,
} from '@/data/companyPeople';
import { useCalendar } from '@/data/companyCalendar';
import { useAttendance, useWorkTasks } from '@/data/companyWorkday';
import { employmentPeople, isNotEmployed } from '@/data/companyEmployment';
import { todayIso } from '@/data/personal';
import { displayName, isGhost, type MemberRow } from '@/data/types';
import { plural, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

const SETTLED: Balance = { kind: 'settled', amount: 0n };

const viewKey = (id: string) => `waves.company.people-view:${id}`;

export function CompanyPeople({
  groupId,
  notEmployed,
  onLeaveNotEmployed,
}: {
  groupId: string;
  notEmployed: boolean;
  onLeaveNotEmployed: () => void;
}) {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const params = useLocalSearchParams<{ filter?: string }>();
  const activeToday = params.filter === 'activeToday';
  const active = useActiveToday(groupId);
  const marks = useAttendance(groupId);
  const allTasks = useWorkTasks(groupId);
  const cal = useCalendar(groupId);
  const [tree, setTree] = useState(false);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<MenuAnchor | 'open' | null>(null);
  const [prefs, setPrefs] = useState({ byName: true, admins: false });
  const buttonRef = useRef<View>(null);
  const edited = useRef(false);
  // The two toggles are remembered per company on this device.
  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(viewKey(groupId))
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as Partial<typeof prefs>) : null;
        if (live && saved && !edited.current)
          setPrefs({ byName: saved.byName !== false, admins: saved.admins === true });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [groupId]);
  const setPref = (next: typeof prefs) => {
    edited.current = true;
    setPrefs(next);
    void AsyncStorage.setItem(viewKey(groupId), JSON.stringify(next)).catch(() => undefined);
  };
  const openMenu = useCallback(
    () =>
      buttonRef.current?.measureInWindow((x, y, width, height) =>
        setMenu(width > 0 ? { x, y, width, height } : 'open'),
      ),
    [],
  );
  const peopleView: PeopleView = { ...DEFAULT_PEOPLE_VIEW, ...prefs, notEmployed };

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
        [...managers, ...employeeRows].filter((m) => m.role === 'manager').map((m) => m.id),
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
      mark: owner || gone ? null : attendanceToday(marks, m.id, today),
      tasks: tasks.get(m.id) ?? 0,
      balance: owner
        ? null
        : m.role === 'manager'
          ? (poolBalances.get(m.id) ?? SETTLED)
          : (balances.get(m.id) ?? SETTLED),
    };
  });
  const shown = listPeople(rows, peopleView, query).filter(
    (r) => r.former || !activeToday || !!active?.activeIds.has(r.id),
  );

  const onLeave = new Set(
    cal.leave
      .filter((l) => l.status === 'approved' && l.startDay <= today && today <= l.endDay)
      .map((l) => l.memberId),
  );
  const statusOf = (r: PeopleRow): PersonStatus =>
    r.former ? 'inactive' : onLeave.has(r.id) ? 'leave' : 'active';
  const count = (s: PersonStatus) => rows.filter((r) => statusOf(r) === s).length;
  const tiles: { icon: keyof typeof Ionicons.glyphMap; n: number; label: string; ink: string }[] = [
    { icon: 'people-outline', n: rows.length, label: t.members, ink: theme.color.brand },
    {
      icon: 'checkmark-circle-outline',
      n: count('active'),
      label: t.company.statusActive,
      ink: theme.color.positive,
    },
    {
      icon: 'person-outline',
      n: count('leave'),
      label: t.company.overviewOnLeave,
      ink: theme.color.warning,
    },
    {
      icon: 'alert-circle-outline',
      n: count('inactive'),
      label: t.company.notEmployed,
      ink: theme.color.textMuted,
    },
  ];

  const thread = (memberId: string): void =>
    router.push(`/group/${groupId}/company-statement?member=${memberId}`);
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

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          gap: 10,
          paddingBottom: clearance + 80,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {tiles.map((x) => (
            <View
              key={x.label}
              accessible
              accessibilityLabel={`${x.label}: ${x.n}`}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 2,
                paddingVertical: 10,
                borderRadius: theme.radius.md,
                backgroundColor: withAlpha(x.ink, 0.1),
              }}
            >
              <Ionicons name={x.icon} size={iconSize.md} color={x.ink} />
              <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: '800' }}>{x.n}</Text>
              <Text variant="micro" tone="muted" numberOfLines={1}>
                {x.label}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              height: 40,
              paddingHorizontal: 14,
              gap: 8,
              borderRadius: theme.radius.md,
              backgroundColor: theme.color.surface,
            }}
          >
            <Ionicons name="search" size={iconSize.md} color={theme.color.textMuted} />
            <TextInput
              value={query}
              onChangeText={(q) => {
                setQuery(q);
                if (q) setTree(false);
              }}
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
          {view.isOwner
            ? round('git-network-outline', t.company.hierTitle, () => setTree((v) => !v), tree)
            : null}
          <View ref={buttonRef} collapsable={false}>
            {/* eslint-disable-next-line react-hooks/refs -- openMenu reads the ref on press, not in render */}
            {round('options-outline', t.company.filterEmployees, openMenu)}
          </View>
        </View>

        {notEmployed ? (
          <Pressable
            accessibilityRole="button"
            onPress={onLeaveNotEmployed}
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
              {t.company.notEmployed}
            </Text>
            <Ionicons name="close-circle-outline" size={iconSize.sm} color={theme.color.brand} />
          </Pressable>
        ) : null}

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

        <TwoStepPeople groupId={groupId} />

        {tree && !notEmployed ? (
          <View>
            {hierarchyRows(view.members).map(({ member: m, level, reports }) => {
              const name = displayName(m, null, null, t.misc.someone);
              const pill =
                m.role === 'admin'
                  ? t.company.pillOwner
                  : m.role === 'manager'
                    ? t.company.manager
                    : null;
              return (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityLabel={pill ? `${name}, ${pill}` : name}
                  onPress={() => thread(m.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 6,
                    marginLeft: level * 18,
                    paddingLeft: level > 0 ? 10 : 0,
                    borderLeftWidth: level > 0 ? 1 : 0,
                    borderLeftColor: theme.color.border,
                  }}
                >
                  <PersonAvatar member={m} name={name} ghost={isGhost(m)} size={36} />
                  <View style={{ flexShrink: 1 }}>
                    <Text numberOfLines={1} style={{ fontWeight: '600' }}>
                      {name}
                    </Text>
                    {m.role === 'manager' ? (
                      <Text variant="caption" tone="muted">
                        {plural(locale, reports, t.company.employeeCount)}
                      </Text>
                    ) : null}
                  </View>
                  {pill ? <RolePill label={pill} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {(!tree || notEmployed) && shown.length > 0 ? (
          <View
            style={{
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              overflow: 'hidden',
            }}
          >
            {shown.map((r, index) => {
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
                  status={statusOf(r)}
                  muted={r.former}
                  divider={index > 0}
                  onPress={() => thread(r.id)}
                />
              );
            })}
          </View>
        ) : null}
        {(!tree || notEmployed) && shown.length === 0 ? (
          <Text variant="caption" tone="muted" align="center" style={{ paddingVertical: 16 }}>
            {rows.some((r) => r.former === notEmployed)
              ? t.company.noEmployeesMatch
              : t.company.noEmployees}
          </Text>
        ) : null}

        <OverflowMenu
          visible={menu !== null}
          onClose={() => setMenu(null)}
          anchor={menu === 'open' ? null : menu}
          items={[
            {
              icon: 'text-outline',
              label: t.company.peopleSortName,
              toggle: { value: prefs.byName, onChange: (byName) => setPref({ ...prefs, byName }) },
            },
            {
              icon: 'shield-outline',
              label: t.company.peopleShowAdmins,
              toggle: { value: prefs.admins, onChange: (admins) => setPref({ ...prefs, admins }) },
            },
          ]}
        />
      </ScrollView>
      {view.suspended ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.company.qaAddEmployee}
          onPress={() => router.push(`/group/${groupId}/members`)}
          style={{
            position: 'absolute',
            right: theme.spacing.lg,
            bottom: clearance + 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 48,
            paddingHorizontal: 20,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.brand,
          }}
        >
          <Ionicons name="add" size={iconSize.md} color={theme.color.onBrand} />
          <Text style={{ color: theme.color.onBrand, fontWeight: '700' }}>
            {t.company.qaAddEmployee}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
