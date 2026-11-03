'use client';

import { useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  allowanceAmount,
  buildWageRun,
  normaliseDecimalInput,
  parseMinorInput,
  wagePaidInPeriod,
  wageRunTotals,
  wageSiteSplit,
  type CurrencyCode,
  type WageTerms,
} from '@waves/core';

import { CompanyFrame } from '@/components/CompanyFrame';
import { SkeletonRows } from '@/components/Skeleton';
import { usePayRule, workedDaysText } from '@/lib/company/calendar';
import { useEmployeeActions } from '@/lib/company/employeeDetail';
import { useEntryActions } from '@/lib/company/entryActions';
import { todayIso, memberName, useCompanyView } from '@/lib/company/view';
import { useAttendance } from '@/lib/company/workday';
import { fillText, wagesStrings as s } from '@/lib/company/wagesStrings';
import { useWagesSites } from '@/lib/company/wagesSites';
import { money } from '@/lib/money';

type Span = 'week' | 'last' | 'month';
type Mode = 'days_rate' | 'fixed_weekly';
type Status = 'present' | 'leave' | 'absent';
type Filter = 'all' | Status;
type Row = { mode: Mode; days: string; fixed: string };

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

export default function CompanyWagesPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const view = useCompanyView(groupId);
  const actions = useEntryActions(groupId);
  const employee = useEmployeeActions(groupId);
  const attendance = useAttendance(groupId);
  const rule = usePayRule(groupId);
  const { sites, onSites } = useWagesSites(groupId);
  const currency = view.currency as CurrencyCode;
  const fmt = (minor: bigint): string => money(minor, view.currency);

  const [span, setSpan] = useState<Span>('week');
  const { start, end } = spanRange(span, todayIso());
  const [terms, setTerms] = useState<Record<string, Row>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [split, setSplit] = useState<Record<string, string[]>>({});
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rateText, setRateText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per run: a retry after a dropped connection replays instead of paying twice.
  const runId = useRef(crypto.randomUUID());

  const defaultRate = view.group?.company_default_daily_rate_minor
    ? BigInt(view.group.company_default_daily_rate_minor)
    : 0n;
  const people = view.members.filter(
    (m) => !m.left_at && view.manageableIds.has(m.id) && m.role === 'member',
  );
  const rateOf = (memberId: string): bigint => {
    const m = people.find((p) => p.id === memberId);
    return m?.daily_rate_minor ? BigInt(m.daily_rate_minor) : defaultRate;
  };
  // Until chosen, a person on exactly one site is paid to that site.
  const pickedFor = (memberId: string): string[] => {
    const own = onSites.get(memberId) ?? [];
    return (split[memberId] ?? (own.length === 1 ? own : [])).filter((id) =>
      sites.some((site) => site.id === id),
    );
  };

  // Days come from attendance for this period (present = 1, half = 0.5) until the person is edited.
  const daysOf = (memberId: string): string =>
    workedDaysText(attendance.values(), memberId, start, end, rule);
  const defaultRow = (memberId: string): Row => ({
    mode: rateOf(memberId) > 0n ? 'days_rate' : 'fixed_weekly',
    days: daysOf(memberId),
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
  }, [terms, view.entries, people.length, start, end, attendance, rule, defaultRate]);

  const statusOf = (memberId: string): Status => {
    const onLeave = rule.leave.some(
      (l) =>
        l.memberId === memberId &&
        l.status === 'approved' &&
        l.startDay <= end &&
        l.endDay >= start,
    );
    if (onLeave) return 'leave';
    const days = daysOf(memberId).trim();
    return days === '' || Number(days) === 0 ? 'absent' : 'present';
  };
  const statuses = new Map(people.map((m) => [m.id, statusOf(m.id)] as const));
  const countOf = (f: Filter): number =>
    f === 'all' ? people.length : people.filter((m) => statuses.get(m.id) === f).length;
  const shown = people.filter((m) => filter === 'all' || statuses.get(m.id) === filter);
  const lines = buildWageRun(view.entries, termMap, end);
  // Only people in the current filter are paid, so nobody is paid out of sight.
  const visible = new Set(shown.map((m) => m.id));
  const chosen = lines.filter((l) => !skipped.has(l.memberId) && visible.has(l.memberId));
  const totals = wageRunTotals(chosen);
  const totalWages = chosen.reduce((sum, l) => sum + l.net, 0n);

  const teamIds = new Set(people.map((m) => m.id));
  const workingDays = new Set(
    [...attendance.values()]
      .filter(
        (m) => teamIds.has(m.memberId) && m.day >= start && m.day <= end && m.status !== 'absent',
      )
      .map((m) => m.day),
  ).size;

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    return next;
  };

  const record = async (): Promise<void> => {
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await actions.payWages({
        runId: runId.current,
        periodStart: start,
        periodEnd: end,
        paidOn: todayIso(),
        lines: chosen.map((l) => {
          // The wage base (not folded bata) is divided evenly; the first sites take any remainder.
          const picked = pickedFor(l.memberId);
          return {
            paymentEntryId: crypto.randomUUID(),
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
      });
      runId.current = crypto.randomUUID();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : s.couldNotSave);
    } finally {
      setBusy(false);
    }
  };

  const saveRate = async (): Promise<void> => {
    const minor = parseMinorInput(rateText, currency);
    const target = rateFor;
    if (!target || minor <= 0n || busy) return;
    setError(null);
    setBusy(true);
    try {
      await employee.setRate({ memberId: target, dailyRateMinor: minor.toString() });
      setRateFor(null);
      setRateText('');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : s.couldNotSave);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel: Record<Status, string> = {
    present: s.wagesPresent,
    leave: s.wagesLeave,
    absent: s.wagesAbsent,
  };

  return (
    <CompanyFrame groupId={groupId}>
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <h1>{s.wagesTitle}</h1>
            <p>{s.wagesSubtitle}</p>
          </div>
          {!view.ready ? (
            <SkeletonRows />
          ) : (
            <>
              <div className="tabs" role="group" aria-label={s.wagesTitle}>
                {(
                  [
                    ['week', s.periodThisWeek],
                    ['last', s.periodLastWeek],
                    ['month', s.periodMonth],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="tab"
                    aria-pressed={span === value}
                    onClick={() => setSpan(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p>
                {start} – {end}
              </p>
              <div className="card">
                <p>
                  {s.wagesTeam}: {people.length} · {s.wagesWorkingDays}: {workingDays} ·{' '}
                  {s.wagesTotal}: {fmt(totalWages)}
                </p>
              </div>
              <p>{s.wageRuleNote}</p>
              {error ? <p role="alert">{error}</p> : null}

              {people.length === 0 ? (
                <p>{s.wagesNoTeam}</p>
              ) : (
                <>
                  <div className="tabs" role="group" aria-label={s.wagesAll}>
                    {(['all', 'present', 'leave', 'absent'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className="tab"
                        aria-pressed={filter === f}
                        onClick={() => setFilter(f)}
                      >
                        {f === 'all' ? s.wagesAll : statusLabel[f]} ({countOf(f)})
                      </button>
                    ))}
                  </div>
                  <div className="card">
                    {shown.map((m) => {
                      const paid = wagePaidInPeriod(view.entries, m.id, start, end);
                      const row = terms[m.id] ?? defaultRow(m.id);
                      const line = lines.find((l) => l.memberId === m.id);
                      const ticked = !!line && !skipped.has(m.id);
                      const isOpen = open.has(m.id) && !paid;
                      const name = memberName(m, 'Someone');
                      const patch = (next: Partial<Row>): void =>
                        setTerms((cur) => ({ ...cur, [m.id]: { ...row, ...next } }));
                      return (
                        <div key={m.id} style={{ opacity: paid ? 0.5 : 1 }}>
                          <label>
                            <input
                              type="checkbox"
                              checked={paid ? true : ticked}
                              disabled={paid || !line}
                              onChange={() => setSkipped((cur) => toggle(cur, m.id))}
                            />{' '}
                            <strong>{name}</strong> · {statusLabel[statuses.get(m.id) ?? 'absent']}{' '}
                            · {row.mode === 'days_rate' ? s.wagesDailyTag : s.wagesFixedTag} ·{' '}
                            {paid ? s.wagesPaid : line ? fmt(line.net) : '—'}
                            {line && !paid
                              ? ` (${
                                  line.calcMode === 'days_rate'
                                    ? fillText(s.wagesRateTimesDays, {
                                        rate: fmt(line.rateMinor ?? 0n),
                                        n: line.days ?? '',
                                      })
                                    : s.wagesFixedTag
                                })`
                              : ''}
                          </label>{' '}
                          {paid ? null : (
                            <button
                              type="button"
                              className="btn soft"
                              aria-expanded={isOpen}
                              onClick={() => setOpen((cur) => toggle(cur, m.id))}
                            >
                              {isOpen ? '−' : '+'}
                            </button>
                          )}
                          {isOpen ? (
                            <div>
                              {line ? (
                                <p>
                                  {[
                                    fillText(s.wagesGross, { amount: fmt(line.base) }),
                                    line.claims > 0n
                                      ? fillText(s.wagesBataIn, { amount: fmt(line.claims) })
                                      : null,
                                    line.recovery > 0n
                                      ? fillText(s.wagesAdvanceCut, { amount: fmt(line.recovery) })
                                      : null,
                                    line.carry > 0n
                                      ? fillText(s.wagesAdvanceLeft, { amount: fmt(line.carry) })
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              ) : null}
                              {line && sites.length > 0 ? (
                                <div>
                                  <span>{s.wagesSites}: </span>
                                  {sites.map((site) => {
                                    const picked = pickedFor(m.id);
                                    const on = picked.includes(site.id);
                                    return (
                                      <label key={site.id}>
                                        <input
                                          type="checkbox"
                                          checked={on}
                                          onChange={() =>
                                            setSplit((cur) => ({
                                              ...cur,
                                              [m.id]: on
                                                ? picked.filter((id) => id !== site.id)
                                                : [...picked, site.id],
                                            }))
                                          }
                                        />{' '}
                                        {site.name}{' '}
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {rateOf(m.id) === 0n ? (
                                <button
                                  type="button"
                                  className="btn soft"
                                  onClick={() => {
                                    setRateText('');
                                    setRateFor(m.id);
                                  }}
                                >
                                  {s.setDailyRate}
                                </button>
                              ) : (
                                <select
                                  value={row.mode}
                                  aria-label={s.wagesTitle}
                                  onChange={(e) => patch({ mode: e.target.value as Mode })}
                                >
                                  <option value="days_rate">{s.wagesDays}</option>
                                  <option value="fixed_weekly">{s.wagesFixedAmount}</option>
                                </select>
                              )}{' '}
                              <input
                                inputMode="decimal"
                                value={row.mode === 'days_rate' ? row.days : row.fixed}
                                placeholder={
                                  row.mode === 'days_rate' ? s.wagesDays : s.wagesFixedAmount
                                }
                                aria-label={
                                  row.mode === 'days_rate' ? s.wagesDays : s.wagesFixedAmount
                                }
                                onChange={(e) =>
                                  patch(
                                    row.mode === 'days_rate'
                                      ? { days: normaliseDecimalInput(e.target.value) }
                                      : { fixed: normaliseDecimalInput(e.target.value) },
                                  )
                                }
                              />
                              {rateFor === m.id ? (
                                <div>
                                  <label>
                                    {s.rateTitle}{' '}
                                    <input
                                      inputMode="decimal"
                                      value={rateText}
                                      onChange={(e) =>
                                        setRateText(normaliseDecimalInput(e.target.value))
                                      }
                                    />
                                  </label>{' '}
                                  <button
                                    type="button"
                                    className="btn brand"
                                    onClick={() => void saveRate()}
                                  >
                                    {s.saveRate}
                                  </button>{' '}
                                  <button
                                    type="button"
                                    className="btn soft"
                                    onClick={() => setRateFor(null)}
                                  >
                                    {s.cancel}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  {done ? (
                    <p role="status">{s.wagesDone}</p>
                  ) : (
                    <div className="card">
                      <p>
                        {fillText(s.wagesSelected, { n: chosen.length })} · {s.wagesTotalPayout}:{' '}
                        <strong>{fmt(totals.net)}</strong>
                      </p>
                      <button
                        type="button"
                        className="btn brand"
                        disabled={chosen.length === 0 || busy}
                        onClick={() => void record()}
                      >
                        {busy ? s.wagesRecording : s.wagesPayAction}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </CompanyFrame>
  );
}
