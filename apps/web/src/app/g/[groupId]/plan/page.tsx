'use client';

/**
 * The trip, day by day: what was planned, and what it actually cost.
 *
 * The reason this lives in Waves rather than in a notes app is the second half.
 * Anything can hold "Dudhsagar falls" under Saturday. Only the app that already
 * has the ledger can put ₹2,000 planned beside ₹3,150 spent, and say the trip
 * is ₹4,000 over on day four.
 *
 * Planned and spent sit next to each other and are never added together, and
 * neither is ever converted into the other's currency (ADR-003). A plan item is
 * not money: it moves nobody's balance, it never reaches the export, and
 * ticking it off is somebody saying they did the thing — not that they paid for
 * it.
 *
 * Every day of the trip appears, including the empty ones, because a planner
 * that hides the days with nothing on them is a planner nobody can plan *into*.
 * `buildTimeline` in `@waves/core` decides that — and everything else about the
 * ordering and the totals — so this screen and the phone's cannot disagree
 * about a trip.
 *
 * Writes go through the three plan RPCs, which check membership themselves
 * (ADR-013). The browser has no offline queue, so each one is awaited and the
 * list re-read; what it does share with the phone is minting the item's id
 * before sending, so a retry replays as the same row instead of a second one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarRange, Check, Plus, Receipt, X } from 'lucide-react';

import {
  buildTimeline,
  budgetVariance,
  dayNumber,
  type PlanItem,
  type TimelineDay,
} from '@waves/core';
import type { Expense, GroupRow, PlanItemRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';
import { planItems, timelineExpenses, todayIn } from '@/lib/planRows';
import { waves } from '@/lib/waves';

export default function PlanPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';

  return (
    <AppFrame current={Section.Groups}>{() => <Plan key={groupId} groupId={groupId} />}</AppFrame>
  );
}

function Plan({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rows, setRows] = useState<PlanItemRow[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [row, bills, plan] = await Promise.all([
      waves.groupRow(groupId),
      waves.expenses(groupId),
      waves.planItems(groupId),
    ]);
    setGroup(row);
    setExpenses(bills);
    setRows(plan);
  }, [groupId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.plan.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, t.errors.couldNotLoad, t.errors.offline]);

  const items = useMemo(() => planItems(rows), [rows]);
  const spend = useMemo(() => timelineExpenses(expenses), [expenses]);

  const startDate = group?.start_date?.slice(0, 10) ?? null;
  const endDate = group?.end_date?.slice(0, 10) ?? null;

  const timeline = useMemo(
    () => buildTimeline({ items, expenses: spend, startDate, endDate }),
    [items, spend, startDate, endDate],
  );

  const variance = useMemo(() => budgetVariance(timeline), [timeline]);
  const today = todayIn(group?.time_zone ?? 'Asia/Kolkata');
  const currentDay = dayNumber(today, startDate, endDate);

  /**
   * A write, then a re-read — as two separate steps.
   *
   * If the write commits and the refresh then fails, the change is real and
   * telling somebody it could not be saved is a lie that makes them do it
   * twice. So only the write's own failure is reported; a failed refresh leaves
   * the screen stale, which the next load fixes.
   */
  const mutate = async (write: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await write();
    } catch (caught) {
      setError(friendlyError(caught, 'web.plan.write', { fallback: t.errors.couldNotSave }));
      setBusy(false);
      return;
    }
    try {
      await load();
    } catch {
      // Committed. The screen is behind, not wrong.
    } finally {
      setBusy(false);
    }
  };

  // `busy` is async state, so a double-click fires two submits in the same tick
  // before React re-renders — each minting its own id, so both post. A ref
  // closes that window; the button still reads `busy` for the disabled state.
  const submitting = useRef(false);

  const submit = async (day: string): Promise<void> => {
    const text = title.trim();
    if (!text || submitting.current) return;
    submitting.current = true;
    const itemId = crypto.randomUUID();
    await mutate(() => waves.addPlanItem({ groupId, day, title: text, itemId }));
    submitting.current = false;
    setTitle('');
    setAddingTo(null);
  };

  if (!ready) return <SkeletonRows rows={6} />;
  if (failed) return <p className="error">{failed}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.plan.title}</h1>
          <div className="sub">
            {group?.name?.trim() || t.plan.subtitle}
            {currentDay !== null ? ` · ${fill(t.plan.dayNumber, { n: String(currentDay) })}` : ''}
          </div>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <PlanTotals
        planned={timeline.plannedByCurrency}
        spent={timeline.spentByCurrency}
        variance={variance}
        locale={locale}
      />

      {timeline.days.length === 0 ? (
        <section className="panel">
          <EmptyState Icon={CalendarRange} title={t.plan.nothingYet} body={t.plan.nothingBody} />
        </section>
      ) : (
        timeline.days.map((day) => (
          <Day
            key={day.day}
            day={day}
            isToday={day.day === today}
            locale={locale}
            busy={busy}
            adding={addingTo === day.day}
            title={title}
            onTitle={setTitle}
            onOpenAdd={() => {
              setAddingTo(day.day);
              setTitle('');
            }}
            onCancelAdd={() => {
              setAddingTo(null);
              setTitle('');
            }}
            onSubmit={() => void submit(day.day)}
            onToggle={(item) => void mutate(() => waves.setPlanItemDone(item.id, !item.done))}
            onRemove={(item) => void mutate(() => waves.removePlanItem(item.id))}
          />
        ))
      )}
    </div>
  );
}

/**
 * Planned against spent, per currency.
 *
 * Never one figure. A trip with a hotel in euros and lunch in rupees has two
 * answers, and inventing a third from a rate nobody agreed is the one thing
 * this app does not do (ADR-003). Positive variance is over, because over is
 * the number somebody came to find.
 */
function PlanTotals({
  planned,
  spent,
  variance,
  locale,
}: {
  planned: Readonly<Record<string, bigint>>;
  spent: Readonly<Record<string, bigint>>;
  variance: Record<string, bigint>;
  locale: string;
}) {
  const { t } = useStrings();
  const currencies = Object.keys(variance).sort();
  if (currencies.length === 0) return null;

  return (
    <section className="panel">
      {currencies.map((currency) => {
        const over = variance[currency] ?? 0n;
        return (
          <div key={currency} className="plan-total">
            <span className="plan-total-pair">
              <span className="k">{t.plan.planned}</span>
              <span className="v">{money(planned[currency] ?? 0n, currency, locale)}</span>
            </span>
            <span className="plan-total-pair">
              <span className="k">{t.plan.spent}</span>
              <span className="v">{money(spent[currency] ?? 0n, currency, locale)}</span>
            </span>
            <span className="plan-total-pair">
              <span className="k">{over > 0n ? t.plan.over : t.plan.under}</span>
              {/* Over is the warning colour, under is not a celebration — an
                  under-budget trip is just a trip, so it stays plain ink. */}
              <span className={over > 0n ? 'v tone-negative' : 'v'}>
                {money(over < 0n ? -over : over, currency, locale)}
              </span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

function Day({
  day,
  isToday,
  locale,
  busy,
  adding,
  title,
  onTitle,
  onOpenAdd,
  onCancelAdd,
  onSubmit,
  onToggle,
  onRemove,
}: {
  day: TimelineDay;
  isToday: boolean;
  locale: string;
  busy: boolean;
  adding: boolean;
  title: string;
  onTitle: (value: string) => void;
  onOpenAdd: () => void;
  onCancelAdd: () => void;
  onSubmit: () => void;
  onToggle: (item: PlanItem) => void;
  onRemove: (item: PlanItem) => void;
}) {
  const { t } = useStrings();
  const label = dayLabel(day.day, locale);
  const empty = day.items.length === 0 && day.expenses.length === 0 && !adding;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className={isToday ? 'plan-day-today' : undefined}>{label}</h2>
        <span className="plan-day-right">
          {Object.entries(day.spentByCurrency).map(([code, amount]) => (
            <span key={code} className="amount">
              {money(amount, code, locale)}
            </span>
          ))}
          <button
            type="button"
            className="icon-btn"
            onClick={onOpenAdd}
            aria-label={`${t.plan.add} — ${label}`}
          >
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
        </span>
      </div>

      {empty ? (
        <p className="faint">{t.plan.emptyDay}</p>
      ) : (
        <div className="list">
          {day.items.map((item) => (
            <div key={item.id} className="plan-row">
              {/* A real checkbox: it is a checkbox to the keyboard and to a
                  screen reader for free, and the tick is the label's own
                  control rather than a glyph pretending to be one. */}
              <label className="plan-tick">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={busy}
                  onChange={() => onToggle(item)}
                />
                <span className="plan-tick-box" aria-hidden>
                  {item.done ? <Check size={13} strokeWidth={3} /> : null}
                </span>
                <span className={item.done ? 'plan-title done' : 'plan-title'}>
                  {/* The time belongs on the same line as the thing it is the
                      time of. `.plan-title` stacks, so without this wrapper
                      "09:30" becomes a line of its own above the title. */}
                  <span className="plan-line">
                    {item.startsAt ? <span className="plan-time">{item.startsAt}</span> : null}
                    {item.title}
                  </span>
                  {item.note ? <span className="meta">{item.note}</span> : null}
                </span>
              </label>
              {item.plannedMinor !== null ? (
                <span className="amount">{money(item.plannedMinor, item.currency, locale)}</span>
              ) : null}
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                onClick={() => onRemove(item)}
                aria-label={fill(t.plan.remove, { title: item.title })}
              >
                <X size={15} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}

          {/* What was actually spent that day, so the plan and the ledger are
              read in one place rather than two screens apart. */}
          {day.expenses.map((expense) => (
            <div key={expense.id} className="plan-row spent">
              <Receipt size={15} strokeWidth={1.75} aria-hidden />
              <span className="grow">{expense.description}</span>
              <span className="amount">{money(expense.amountMinor, expense.currency, locale)}</span>
            </div>
          ))}

          {adding ? (
            <form
              className="plan-add"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              <input
                id={`plan-add-${day.day}`}
                className="split-input"
                value={title}
                autoFocus
                placeholder={t.plan.whatIsPlanned}
                aria-label={`${t.plan.whatIsPlanned} — ${label}`}
                onChange={(event) => onTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') onCancelAdd();
                }}
              />
              {/* The two answers stay together when the row wraps. Loose, they
                  wrap one at a time and Cancel ends up alone on a third line. */}
              <span className="plan-add-actions">
                <button type="submit" className="btn brand" disabled={busy || !title.trim()}>
                  {t.plan.add}
                </button>
                <button type="button" className="btn soft" onClick={onCancelAdd}>
                  {t.plan.cancel}
                </button>
              </span>
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * 'YYYY-MM-DD' as a weekday and date, read from its parts in UTC — so a reader
 * east of the line does not see the 1st labelled as the last of the month
 * before.
 */
function dayLabel(day: string, locale: string): string {
  const [year, month, date] = day.split('-');
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(date))));
}
