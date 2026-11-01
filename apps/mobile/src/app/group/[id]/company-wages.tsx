/**
 * Pay wages: one compact list for a period. Per person: days x daily rate (or a fixed
 * amount), plus bata owed, less any advance still to recover (never more than the
 * wage, the rest carries to the next time) = what to pay. Tick who to pay and record
 * it in one tap. One run id makes a retry safe; a person already paid for the period
 * is shown as paid and cannot be ticked, so the server never has to refuse.
 */

import { SuspendedGate } from '@/components/company/SuspendedBanner';
import { useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  allowanceAmount,
  buildWageRun,
  format,
  money,
  normaliseDecimalInput,
  parseMinorInput,
  wagePaidInPeriod,
  wageRunTotals,
  wageSiteSplit,
  type CurrencyCode,
  type WageTerms,
} from '@waves/core';
import { usePayRule, workedDaysText } from '@/data/companyCalendar';
import { Button, Chip, ChipRow, Screen, Text, iconSize, useTheme } from '@waves/ui';
import { teamWorkingDays, wageStatus, type WageStatus } from '@/lib/wageStatusPure';

import { PersonAvatar } from '@/components/PersonAvatar';
import {
  PILL_SELECTED,
  ScenicBody,
  ScenicHeader,
  StandardCard,
  useGlass,
} from '@/components/standard';
import { EditTextSheet } from '@/components/EditTextSheet';
import {
  useCompanyEntries,
  useCompanyProjectMembers,
  useCompanyProjects,
  usePayWages,
  useSetCompanyRate,
} from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { useAttendance } from '@/data/companyWorkday';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

type Span = 'week' | 'last' | 'month';
type Mode = 'days_rate' | 'fixed_weekly';
type Filter = 'all' | WageStatus;

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function spanRange(span: Span, today: string): { start: string; end: string } {
  if (span === 'week') return { start: shiftDay(today, -6), end: today };
  if (span === 'last') return { start: shiftDay(today, -13), end: shiftDay(today, -7) };
  return { start: `${today.slice(0, 8)}01`, end: today };
}

/** "Oct 27 – Nov 2" in the viewer's language. */
function rangeLabel(start: string, end: string, locale: string): string {
  const f = (iso: string): string =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return `${f(start)} – ${f(end)}`;
}

function IconCircle({
  name,
  tint,
  color,
  size = 36,
}: {
  name: keyof typeof Ionicons.glyphMap;
  tint: string;
  color: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={name} size={iconSize.lg} color={color} />
    </View>
  );
}

function CompanyWagesScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const view = useCompanyEntries(groupId);
  const pay = usePayWages(groupId);
  const setRate = useSetCompanyRate(groupId);
  const sites = useCompanyProjects(groupId).filter((p) => !p.archived_at);
  const onSites = useCompanyProjectMembers(groupId);
  // Sites a person's wage is divided across this run (empty = not allocated to a site).
  const [split, setSplit] = useState<Record<string, string[]>>({});
  // Until chosen, a person on exactly one site is paid to that site.
  const pickedFor = (memberId: string): string[] => {
    const own = onSites.get(memberId) ?? [];
    return (split[memberId] ?? (own.length === 1 ? own : [])).filter((id) =>
      sites.some((s) => s.id === id),
    );
  };
  // The daily rate is asked here, the first time wages need it, not in a settings screen.
  const [rateFor, setRateFor] = useState<string | null>(null);
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => format(money(minor, currency), { locale });

  const [span, setSpan] = useState<Span>('week');
  const { start, end } = spanRange(span, todayIso());
  const [terms, setTerms] = useState<Record<string, { mode: Mode; days: string; fixed: string }>>(
    {},
  );
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const glass = useGlass();
  // One id per run: a retry after a dropped connection replays instead of paying twice.
  const runId = useRef(randomUUID());

  const people = view.members.filter(
    (m) => !m.left_at && view.manageableIds.has(m.id) && m.role === 'member',
  );
  const rateOf = (memberId: string): bigint => {
    const m = people.find((p) => p.id === memberId);
    return m?.daily_rate_minor ? BigInt(m.daily_rate_minor) : (view.defaultRateMinor ?? 0n);
  };

  // Days come from attendance for this period (present = 1, half = 0.5) until the person is edited.
  const attendance = useAttendance(groupId);
  const rule = usePayRule(groupId);
  const defaultRow = (memberId: string): { mode: Mode; days: string; fixed: string } => ({
    mode: rateOf(memberId) > 0n ? 'days_rate' : 'fixed_weekly',
    days: workedDaysText(attendance.values(), memberId, start, end, rule),
    fixed: '',
  });

  const termMap = useMemo(() => {
    const map = new Map<string, WageTerms>();
    for (const m of people) {
      if (wagePaidInPeriod(view.entries, m.id, start, end)) continue;
      const row = terms[m.id] ?? defaultRow(m.id);
      if (row.mode === 'days_rate') {
        if (allowanceAmount(row.days, rateOf(m.id)) === null) continue;
        map.set(m.id, { calcMode: 'days_rate', days: row.days.trim(), rateMinor: rateOf(m.id) });
      } else if (row.fixed.trim() !== '') {
        map.set(m.id, {
          calcMode: 'fixed_weekly',
          fixedMinor: parseMinorInput(row.fixed, currency),
        });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, view.entries, people.length, start, end, attendance, rule]);

  const statusOf = (memberId: string): WageStatus =>
    wageStatus(
      memberId,
      workedDaysText(attendance.values(), memberId, start, end, rule),
      rule.leave,
      start,
      end,
    );
  const statuses = new Map(people.map((m) => [m.id, statusOf(m.id)] as const));
  const countOf = (f: Filter): number =>
    f === 'all' ? people.length : people.filter((m) => statuses.get(m.id) === f).length;
  const shown = people.filter((m) => filter === 'all' || statuses.get(m.id) === filter);
  const lines = buildWageRun(view.entries, termMap, end);
  // Only people in the current filter are paid, so nobody is paid out of sight.
  const visible = new Set(shown.map((m) => m.id));
  const chosen = lines.filter((l) => !skipped.has(l.memberId) && visible.has(l.memberId));
  const totals = wageRunTotals(chosen);

  const record = (): void => {
    if (chosen.length === 0) return;
    pay.mutate(
      {
        runId: runId.current,
        periodStart: start,
        periodEnd: end,
        paidOn: todayIso(),
        lines: chosen.map((l) => {
          // The wage base (not folded bata) is divided evenly; the first sites take any remainder.
          const picked = pickedFor(l.memberId);
          return {
            paymentEntryId: randomUUID(),
            memberId: l.memberId,
            ...wageSiteSplit(l.base, picked),
            fundingManagerId: view.isManager ? (view.me?.id ?? null) : null,
            calcMode: l.calcMode as 'typed' | 'days_rate' | 'fixed_weekly' | 'fixed_monthly',
            days: l.days,
            rateMinor: l.rateMinor?.toString() ?? null,
            fixedMinor: l.fixedMinor?.toString() ?? null,
            claimIds: l.claimIds,
            expectedGrossMinor: l.gross.toString(),
            expectedRecoveryMinor: l.recovery.toString(),
            expectedNetMinor: l.net.toString(),
            note: null,
          };
        }),
      },
      {
        onSuccess: () => {
          runId.current = randomUUID();
          setDone(true);
        },
      },
    );
  };

  const workingDays = teamWorkingDays(
    attendance.values(),
    new Set(people.map((m) => m.id)),
    start,
    end,
  );
  const totalWages = lines.reduce((sum, l) => sum + l.net, 0n);
  const statusLook = (s: WageStatus) =>
    s === 'present'
      ? {
          fg: theme.color.positive,
          bg: theme.color.positiveSoft,
          icon: 'checkmark-circle' as const,
          label: t.company.wagesPresent,
        }
      : s === 'leave'
        ? {
            fg: theme.color.warning,
            bg: theme.color.warningSoft,
            icon: 'time' as const,
            label: t.company.wagesLeave,
          }
        : {
            fg: theme.color.negative,
            bg: theme.color.negativeSoft,
            icon: 'close-circle' as const,
            label: t.company.wagesAbsent,
          };
  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const cardStyle = {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
  };

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 112 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader
          title={t.company.wagesSheetTitle}
          wide
          identity={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.surface,
                }}
              >
                <Ionicons name="people" size={24} color={theme.color.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  variant="heading"
                  numberOfLines={1}
                  style={{ fontSize: 22, fontWeight: '800' }}
                >
                  {t.company.wagesSheetTitle}
                </Text>
                <Text variant="micro" numberOfLines={1}>
                  {t.company.wagesSubtitle}
                </Text>
              </View>
            </View>
          }
        >
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flex: 1 }}>
            {(
              [
                ['week', t.company.periodThisWeek],
                ['last', t.company.periodLastWeek],
                ['month', t.company.periodMonth],
              ] as const
            ).map(([value, label]) => {
              const on = span === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSpan(value)}
                  style={{
                    flex: on ? 1.6 : 1,
                    minHeight: 44,
                    borderRadius: theme.radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: theme.spacing.sm,
                    backgroundColor: on ? PILL_SELECTED : glass,
                  }}
                >
                  <Text
                    variant="caption"
                    numberOfLines={1}
                    style={{ fontWeight: '700', color: on ? '#FFFFFF' : theme.color.textMuted }}
                  >
                    {label}
                  </Text>
                  {on ? (
                    <Text variant="micro" numberOfLines={1} style={{ color: '#FFFFFF' }}>
                      {rangeLabel(start, end, locale)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScenicHeader>
        <ScenicBody>
          <StandardCard>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              {(
                [
                  [
                    'people',
                    theme.color.brandSoft,
                    theme.color.brand,
                    String(people.length),
                    t.company.wagesTeam,
                  ],
                  [
                    'calendar',
                    theme.color.positiveSoft,
                    theme.color.positive,
                    String(workingDays),
                    t.company.wagesWorkingDays,
                  ],
                  [
                    'wallet',
                    theme.color.brandSoft,
                    theme.color.brand,
                    fmt(totalWages),
                    t.company.wagesTotal,
                  ],
                ] as const
              ).map(([icon, tint, color, value, label], i) => (
                <View
                  key={label}
                  style={{
                    flex: i === 2 ? 1.5 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    minWidth: 0,
                  }}
                >
                  <IconCircle name={icon} tint={tint} color={color} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      variant="body"
                      numberOfLines={1}
                      style={{ fontWeight: '800', fontSize: 16 }}
                    >
                      {value}
                    </Text>
                    <Text variant="micro" tone="muted" numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </StandardCard>
          <View
            style={{
              flexDirection: 'row',
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons
              name="information-circle-outline"
              size={iconSize.lg}
              color={theme.color.brand}
            />
            <Text variant="caption" style={{ flex: 1 }}>
              {t.calendar.wageRuleNote}
            </Text>
          </View>
          {people.length === 0 ? (
            <Text variant="body" tone="muted">
              {t.company.wagesNoTeam}
            </Text>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {(['all', 'present', 'leave', 'absent'] as const).map((f) => {
                    const on = filter === f;
                    const look = f === 'all' ? null : statusLook(f);
                    const label = `${f === 'all' ? t.company.wagesAll : look!.label} (${countOf(f)})`;
                    return (
                      <Pressable
                        key={f}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => setFilter(f)}
                        style={{
                          height: 38,
                          paddingHorizontal: theme.spacing.md,
                          borderRadius: theme.radius.pill,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.xs,
                          backgroundColor: on ? theme.color.brandSoft : glass,
                          borderWidth: 1,
                          borderColor: on ? theme.color.brand : 'transparent',
                        }}
                      >
                        {look ? (
                          <View
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: look.fg,
                            }}
                          />
                        ) : null}
                        <Text
                          variant="caption"
                          style={{
                            fontWeight: '600',
                            color: on ? theme.color.brand : theme.color.text,
                          }}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              <StandardCard style={{ gap: 0 }}>
                {shown.map((m, idx) => {
                  const paid = wagePaidInPeriod(view.entries, m.id, start, end);
                  const row = terms[m.id] ?? defaultRow(m.id);
                  const line = lines.find((l) => l.memberId === m.id);
                  const ticked = !!line && !skipped.has(m.id);
                  const isOpen = open.has(m.id) && !paid;
                  const look = statusLook(statuses.get(m.id) ?? 'absent');
                  const name = displayName(m, null, null, t.misc.someone);
                  const patch = (next: Partial<typeof row>): void =>
                    setTerms((cur) => ({ ...cur, [m.id]: { ...row, ...next } }));
                  return (
                    <View
                      key={m.id}
                      style={{
                        opacity: paid ? 0.5 : 1,
                        paddingVertical: theme.spacing.sm,
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderTopColor: theme.color.border,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.sm,
                        }}
                      >
                        {paid ? (
                          <Ionicons
                            name="checkmark-circle"
                            size={iconSize.xl}
                            color={theme.color.brand}
                          />
                        ) : (
                          <Pressable
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: ticked, disabled: !line }}
                            accessibilityLabel={name}
                            disabled={!line}
                            onPress={() => setSkipped((cur) => toggle(cur, m.id))}
                            hitSlop={8}
                          >
                            <Ionicons
                              name={ticked ? 'checkbox' : 'square-outline'}
                              size={iconSize.xl}
                              color={ticked ? theme.color.brand : theme.color.textMuted}
                            />
                          </Pressable>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: isOpen }}
                          accessibilityLabel={name}
                          disabled={paid}
                          onPress={() => setOpen((cur) => toggle(cur, m.id))}
                          style={{
                            flex: 1,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.sm,
                            minHeight: 48,
                          }}
                        >
                          <PersonAvatar member={m} name={name} ghost={isGhost(m)} size={36} />
                          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                            <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                              {name}
                            </Text>
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: theme.spacing.xs,
                              }}
                            >
                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 3,
                                  paddingHorizontal: 6,
                                  paddingVertical: 1,
                                  borderRadius: theme.radius.pill,
                                  backgroundColor: look.bg,
                                }}
                              >
                                <Ionicons name={look.icon} size={iconSize.xs} color={look.fg} />
                                <Text variant="micro" style={{ color: look.fg, fontWeight: '600' }}>
                                  {look.label}
                                </Text>
                              </View>
                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 3,
                                  paddingHorizontal: 6,
                                  paddingVertical: 1,
                                  borderRadius: theme.radius.pill,
                                  backgroundColor: theme.color.brandSoft,
                                }}
                              >
                                <Ionicons
                                  name={
                                    row.mode === 'days_rate'
                                      ? 'calendar-outline'
                                      : 'document-text-outline'
                                  }
                                  size={iconSize.xs}
                                  color={theme.color.brand}
                                />
                                <Text
                                  variant="micro"
                                  style={{ color: theme.color.brand, fontWeight: '600' }}
                                >
                                  {row.mode === 'days_rate'
                                    ? t.company.wagesDailyTag
                                    : t.company.wagesFixedTag}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text variant="body" style={{ fontWeight: '800' }}>
                              {line ? fmt(line.net) : '—'}
                            </Text>
                            {line ? (
                              <Text variant="micro" tone="muted" numberOfLines={1}>
                                {line.calcMode === 'days_rate'
                                  ? fill(t.company.wagesRateTimesDays, {
                                      rate: fmt(line.rateMinor ?? 0n),
                                      n: line.days ?? '',
                                    })
                                  : t.company.wagesFixedTag}
                              </Text>
                            ) : null}
                          </View>
                          {paid ? null : (
                            <Ionicons
                              name="chevron-forward"
                              size={iconSize.md}
                              color={theme.color.textMuted}
                              style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}
                            />
                          )}
                        </Pressable>
                      </View>
                      {isOpen ? (
                        <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}>
                          {line ? (
                            <Text variant="caption" tone="muted" numberOfLines={2}>
                              {[
                                fill(t.company.wagesGross, { amount: fmt(line.base) }),
                                line.claims > 0n
                                  ? fill(t.company.wagesBataIn, { amount: fmt(line.claims) })
                                  : null,
                                line.recovery > 0n
                                  ? fill(t.company.wagesAdvanceCut, { amount: fmt(line.recovery) })
                                  : null,
                                line.carry > 0n
                                  ? fill(t.company.wagesAdvanceLeft, { amount: fmt(line.carry) })
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          ) : null}
                          {line && sites.length > 0 ? (
                            <View
                              style={{
                                flexDirection: 'row',
                                flexWrap: 'wrap',
                                gap: theme.spacing.sm,
                              }}
                            >
                              {sites.map((site) => {
                                const picked = pickedFor(m.id);
                                const on = picked.includes(site.id);
                                return (
                                  <Chip
                                    key={site.id}
                                    label={site.name}
                                    selected={on}
                                    onCard
                                    repeatable
                                    onPress={() =>
                                      setSplit((cur) => ({
                                        ...cur,
                                        [m.id]: on
                                          ? picked.filter((id) => id !== site.id)
                                          : [...picked, site.id],
                                      }))
                                    }
                                  />
                                );
                              })}
                            </View>
                          ) : null}
                          {
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: theme.spacing.sm,
                              }}
                            >
                              {rateOf(m.id) === 0n ? (
                                <Chip
                                  label={t.company.setDailyRate}
                                  onCard
                                  onPress={() => setRateFor(m.id)}
                                />
                              ) : (
                                <ChipRow
                                  onCard
                                  options={[
                                    { value: 'days_rate' as Mode, label: t.company.wagesDays },
                                    {
                                      value: 'fixed_weekly' as Mode,
                                      label: t.company.wagesFixedAmount,
                                    },
                                  ]}
                                  value={row.mode}
                                  onChange={(mode) => patch({ mode })}
                                />
                              )}
                              <TextInput
                                value={row.mode === 'days_rate' ? row.days : row.fixed}
                                onChangeText={(text) =>
                                  patch(
                                    row.mode === 'days_rate'
                                      ? { days: normaliseDecimalInput(text) }
                                      : { fixed: normaliseDecimalInput(text) },
                                  )
                                }
                                keyboardType="decimal-pad"
                                placeholder={
                                  row.mode === 'days_rate'
                                    ? t.company.wagesDays
                                    : t.company.wagesFixedAmount
                                }
                                placeholderTextColor={theme.color.textFaint}
                                accessibilityLabel={
                                  row.mode === 'days_rate'
                                    ? t.company.wagesDays
                                    : t.company.wagesFixedAmount
                                }
                                style={{
                                  flex: 1,
                                  borderWidth: 1,
                                  borderColor: theme.color.border,
                                  borderRadius: theme.radius.lg,
                                  paddingHorizontal: theme.spacing.md,
                                  height: 40,
                                  fontSize: 16,
                                  color: theme.color.text,
                                  backgroundColor: theme.color.surface,
                                }}
                              />
                            </View>
                          }
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </StandardCard>
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                {view.isAdmin ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.company.wagesAddMember}
                    onPress={() => router.push(`/group/${groupId}/members` as never)}
                    style={{ ...cardStyle, justifyContent: 'center' }}
                  >
                    <Ionicons
                      name="person-add-outline"
                      size={iconSize.lg}
                      color={theme.color.brand}
                    />
                    <Text variant="caption" style={{ fontWeight: '700' }}>
                      {t.company.wagesAddMember}
                    </Text>
                  </Pressable>
                ) : null}
                {view.isOwner ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.company.wagesManageRates}
                    onPress={() => router.push(`/group/${groupId}/company-more` as never)}
                    style={cardStyle}
                  >
                    <Ionicons
                      name="settings-outline"
                      size={iconSize.lg}
                      color={theme.color.brand}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" style={{ fontWeight: '700' }}>
                        {t.company.wagesManageRates}
                      </Text>
                      <Text variant="micro" tone="muted">
                        {t.company.wagesManageRatesSub}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </ScenicBody>
      </ScrollView>
      <EditTextSheet
        visible={rateFor !== null}
        title={t.company.rateTitle}
        value=""
        autoCapitalize="none"
        saving={setRate.isPending}
        onClose={() => setRateFor(null)}
        onSave={(text) => {
          const minor = parseMinorInput(text, currency);
          const target = rateFor;
          setRateFor(null);
          if (target && minor > 0n)
            setRate.mutate({ memberId: target, dailyRateMinor: minor.toString() });
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          backgroundColor: theme.color.bg,
        }}
      >
        {done ? (
          <Button label={t.company.wagesDone} onPress={() => router.back()} fullWidth />
        ) : (
          <>
            <View>
              <Text variant="caption" style={{ fontWeight: '700' }}>
                {fill(t.company.wagesSelected, { n: String(chosen.length) })}
              </Text>
              <Text variant="micro" tone="muted">
                {t.company.wagesTotalPayout}
              </Text>
            </View>
            <Text
              variant="heading"
              numberOfLines={1}
              style={{
                flex: 1,
                minWidth: 72,
                fontSize: 18,
                fontWeight: '800',
                color: theme.color.brand,
              }}
            >
              {fmt(totals.net)}
            </Text>
            <Button
              label={t.company.wagesPayAction}
              icon={
                <Ionicons
                  name="wallet-outline"
                  size={iconSize.lg}
                  color={theme.color.onButtonPrimary}
                />
              }
              disabled={chosen.length === 0 || pay.isPending}
              onPress={record}
            />
          </>
        )}
      </View>
    </Screen>
  );
}

export default function CompanyWagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SuspendedGate groupId={id ?? ''}>
      <CompanyWagesScreenInner />
    </SuspendedGate>
  );
}
