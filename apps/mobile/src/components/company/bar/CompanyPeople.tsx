/**
 * People (the Team tab's first segment; TeamScreen draws the header): one compact card per person.
 * Default list = employed employees by name; the sort pop-up toggles name sort and admins (managers and
 * owners, within the viewer's visible set). Not employed is a mode set from the header menu. Every per-person number (today's
 * mark, open tasks, balance) is computed once per render into a map, never per row.
 * shortcut: no "On leave" (no leave data exists yet).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Text, iconSize, useTheme } from '@waves/ui';

import { PersonCard } from '@/components/company/bar/PersonCard';
import { OverflowMenu } from '@/components/OverflowMenu';
import type { MenuAnchor } from '@/components/SortMenu';
import { useCompanyEntries } from '@/data/companyEntries';
import { useActiveToday } from '@/data/companyOverview';
import {
  DEFAULT_PEOPLE_VIEW,
  attendanceToday,
  balancesByMember,
  listPeople,
  managerBalances,
  openTasksToday,
  wholeMoney,
  type Balance,
  type PeopleRow,
  type PeopleView,
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
  const [searching, setSearching] = useState(false);
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
            <View ref={buttonRef} collapsable={false}>
              {/* eslint-disable-next-line react-hooks/refs -- openMenu reads the ref on press, not in render */}
              {round('swap-vertical', t.company.filterEmployees, openMenu)}
            </View>
          </>
        )}
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
  );
}
