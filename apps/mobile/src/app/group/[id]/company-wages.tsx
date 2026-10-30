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
import { Button, Chip, ChipRow, Screen, Text, iconSize, useTheme } from '@waves/ui';

import { PersonAvatar } from '@/components/PersonAvatar';
import { ScenicBody, ScenicHeader, StandardCard } from '@/components/standard';
import { EditTextSheet } from '@/components/EditTextSheet';
import {
  useCompanyEntries,
  useCompanyProjectMembers,
  useCompanyProjects,
  usePayWages,
  useSetCompanyRate,
} from '@/data/companyEntries';
import { todayIso } from '@/data/personal';
import { displayName, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

type Span = 'week' | 'last' | 'month';
type Mode = 'days_rate' | 'fixed_weekly';

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
  // One id per run: a retry after a dropped connection replays instead of paying twice.
  const runId = useRef(randomUUID());

  const people = view.members.filter(
    (m) => !m.left_at && view.manageableIds.has(m.id) && m.role === 'member',
  );
  const rateOf = (memberId: string): bigint => {
    const m = people.find((p) => p.id === memberId);
    return m?.daily_rate_minor ? BigInt(m.daily_rate_minor) : (view.defaultRateMinor ?? 0n);
  };

  const termMap = useMemo(() => {
    const map = new Map<string, WageTerms>();
    for (const m of people) {
      if (wagePaidInPeriod(view.entries, m.id, start, end)) continue;
      const row = terms[m.id];
      if (!row) continue;
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
  }, [terms, view.entries, people.length, start, end]);

  const lines = buildWageRun(view.entries, termMap, end);
  const chosen = lines.filter((l) => !skipped.has(l.memberId));
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

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: clearance + 96 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.company.wagesSheetTitle}>
          <ChipRow
            options={[
              { value: 'week' as Span, label: t.company.periodThisWeek },
              { value: 'last' as Span, label: t.company.periodLastWeek },
              { value: 'month' as Span, label: t.company.periodMonth },
            ]}
            value={span}
            onChange={setSpan}
          />
        </ScenicHeader>
        <ScenicBody>
          {people.length === 0 ? (
            <Text variant="body" tone="muted">
              {t.company.wagesNoTeam}
            </Text>
          ) : (
            <StandardCard style={{ gap: theme.spacing.md }}>
              {people.map((m) => {
                const paid = wagePaidInPeriod(view.entries, m.id, start, end);
                const row = terms[m.id] ?? {
                  mode: rateOf(m.id) > 0n ? ('days_rate' as Mode) : ('fixed_weekly' as Mode),
                  days: '',
                  fixed: '',
                };
                const line = lines.find((l) => l.memberId === m.id);
                const ticked = !!line && !skipped.has(m.id);
                const patch = (next: Partial<typeof row>): void =>
                  setTerms((cur) => ({ ...cur, [m.id]: { ...row, ...next } }));
                return (
                  <View key={m.id} style={{ gap: theme.spacing.sm, opacity: paid ? 0.5 : 1 }}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
                    >
                      <PersonAvatar member={m} name={displayName(m)} ghost={isGhost(m)} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text variant="body" numberOfLines={1}>
                          {displayName(m, null, null, t.misc.someone)}
                        </Text>
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
                      </View>
                      {paid ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={iconSize.lg}
                          color={theme.color.brand}
                        />
                      ) : line ? (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: ticked }}
                          accessibilityLabel={displayName(m, null, null, t.misc.someone)}
                          onPress={() =>
                            setSkipped((cur) => {
                              const next = new Set(cur);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            })
                          }
                          hitSlop={8}
                        >
                          <Ionicons
                            name={ticked ? 'checkbox' : 'square-outline'}
                            size={iconSize.lg}
                            color={ticked ? theme.color.brand : theme.color.textMuted}
                          />
                        </Pressable>
                      ) : null}
                      {line ? (
                        <Text variant="body" style={{ minWidth: 72, textAlign: 'right' }}>
                          {fmt(line.net)}
                        </Text>
                      ) : null}
                    </View>
                    {!paid && line && sites.length > 0 ? (
                      <View
                        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
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
                    {paid ? null : (
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
                              { value: 'fixed_weekly' as Mode, label: t.company.wagesFixedAmount },
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
                    )}
                  </View>
                );
              })}
            </StandardCard>
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
          padding: theme.spacing.lg,
          paddingBottom: clearance,
          backgroundColor: theme.color.bg,
        }}
      >
        {done ? (
          <Button label={t.company.wagesDone} onPress={() => router.back()} fullWidth />
        ) : (
          <Button
            label={fill(t.company.wagesRecord, {
              n: String(chosen.length),
              amount: fmt(totals.net),
            })}
            disabled={chosen.length === 0 || pay.isPending}
            onPress={record}
            fullWidth
          />
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
