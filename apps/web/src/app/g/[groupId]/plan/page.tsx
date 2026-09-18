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
  budgetProgress,
  buildTimeline,
  budgetVariance,
  dayNumber,
  fairness,
  forecast,
  spendByMember,
  type PlanItem,
  type TimelineDay,
} from '@waves/core';
import {
  GroupType,
  nameOf,
  type Expense,
  type GroupRow,
  type Member,
  type MemberBudgetRow,
  type PlanItemRow,
} from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { TripBudgets, type MemberBudget } from '@/components/TripBudgets';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';
import {
  contributions,
  planItems,
  sharedExpenses,
  timelineExpenses,
  todayIn,
} from '@/lib/planRows';
import { waves } from '@/lib/waves';

export default function PlanPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';

  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => <Plan key={groupId} groupId={groupId} myProfileId={profileId} />}
    </AppFrame>
  );
}

function Plan({ groupId, myProfileId }: { groupId: string; myProfileId: string }) {
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rows, setRows] = useState<PlanItemRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [budgetRows, setBudgetRows] = useState<MemberBudgetRow[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The id the next add will carry.
   *
   * It belongs to one attempt at one item, which is a narrower thing than it
   * sounds. Keeping it across a straight retry is the whole point: if the
   * server took the row and only the answer went missing, sending the same id
   * replays that write instead of adding a second copy.
   *
   * But `waves_add_plan_item` answers a known id by returning the existing row
   * and reading none of the rest — so the same id carrying *different* words,
   * or the same words on a different day, would be swallowed and the new item
   * silently lost. So the moment a draft is abandoned or pointed at another
   * day, it stops being that attempt and gets a fresh id.
   */
  const [draft, setDraft] = useState(() => crypto.randomUUID());
  const abandonDraft = () => setDraft(crypto.randomUUID());

  const load = useCallback(async () => {
    const [row, bills, plan, people, budgets] = await Promise.all([
      waves.groupRow(groupId),
      waves.expenses(groupId),
      waves.planItems(groupId),
      waves.members(groupId),
      waves.memberBudgets(groupId),
    ]);
    setGroup(row);
    setExpenses(bills);
    setRows(plan);
    setMembers(people);
    setBudgetRows(budgets);
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

  const currency = group?.default_currency ?? 'INR';
  const myMember = members.find((member) => member.profile_id === myProfileId) ?? null;

  /** What each member's trip has cost *them* — the figure a personal cap sits on. */
  const memberSpend = useMemo(() => spendByMember(sharedExpenses(expenses)), [expenses]);

  /** The trip's own cap, or null when nobody set one. Null is not a cap of zero. */
  const overallCap =
    group?.budget_minor != null
      ? {
          amountMinor: BigInt(group.budget_minor),
          currency: group.budget_currency ?? currency,
        }
      : null;

  const overallBudget = budgetProgress(overallCap, timeline.spentByCurrency);

  // Mine first, then everybody who shared. A row whose budget measures nothing
  // is dropped rather than drawn as an empty bar.
  const memberBudgets = useMemo(() => {
    const out: MemberBudget[] = [];
    for (const row of budgetRows) {
      const progress = budgetProgress(
        { amountMinor: BigInt(row.amount_minor), currency: row.currency },
        memberSpend.get(row.member_id),
      );
      if (!progress) continue;
      const member = members.find((person) => person.id === row.member_id) ?? null;
      out.push({
        memberId: row.member_id,
        name: member ? nameOf(member) : t.budgets.someone,
        isMine: row.member_id === (myMember?.id ?? null),
        shared: row.visibility === 'group',
        progress,
      });
    }
    return out.sort((a, b) => Number(b.isMine) - Number(a.isMine));
  }, [budgetRows, members, memberSpend, myMember?.id, t.budgets.someone]);

  // At this pace, where does the trip land? Empty until the trip has dates and
  // a day of spend to read a pace from. Not hand-memoized: the compiler does it,
  // and a dep list that did not match what this reads is what it objected to.
  const forecasts = forecast({
    spentByCurrency: timeline.spentByCurrency,
    budget: overallCap,
    today,
    startDate,
    endDate,
  });

  // Who has been carrying the fronting. Paid comes from the payers, owed from
  // the shares — both already on the ledger, neither re-divided here.
  const fairnessSignals = useMemo(
    () => fairness(contributions(expenses)).filter((block) => block.overpayer || block.nextPayer),
    [expenses],
  );

  /**
   * A write, then a re-read — as two separate steps.
   *
   * If the write commits and the refresh then fails, the change is real and
   * telling somebody it could not be saved is a lie that makes them do it
   * twice. So only the write's own failure is reported; a failed refresh leaves
   * the screen stale, which the next load fixes.
   */
  const mutate = async (write: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await write();
    } catch (caught) {
      setError(friendlyError(caught, 'web.plan.write', { fallback: t.errors.couldNotSave }));
      setBusy(false);
      return false;
    }
    try {
      await load();
    } catch {
      // Committed. The screen is behind, not wrong.
    } finally {
      setBusy(false);
    }
    return true;
  };

  // `busy` is async state, so a double-click fires two submits in the same tick
  // before React re-renders — each minting its own id, so both post. A ref
  // closes that window; the button still reads `busy` for the disabled state.
  const submitting = useRef(false);

  const submit = async (day: string): Promise<void> => {
    const text = title.trim();
    if (!text || submitting.current) return;
    submitting.current = true;
    const saved = await mutate(() =>
      waves.addPlanItem({ groupId, day, title: text, itemId: draft }),
    );
    submitting.current = false;
    // A failed add keeps both the words and the id, and leaves the field open:
    // pressing Add again is the replay. Clearing them would throw away what
    // somebody typed and the only thing that makes a second attempt safe.
    if (!saved) return;
    abandonDraft();
    setTitle('');
    setAddingTo(null);
  };

  if (!ready) return <SkeletonRows rows={6} />;
  if (failed) return <p className="error">{failed}</p>;

  /**
   * Only a trip can be planned into — and unlike the recap, which merely reads,
   * this screen writes. The link is offered for trips only on both clients, and
   * nothing in the database stops a plan row being attached to a flatshare. So
   * a row written here from a typed URL on a non-trip group would be a row no
   * screen ever shows again: work that disappears.
   *
   * The plan is still *shown*, because rows that already exist are real and
   * hiding them would be its own kind of lying. It just cannot be added to.
   */
  const canEdit = group?.type === GroupType.Trip;

  /**
   * A member id as a name. Somebody can share a budget or front the most and
   * then leave, and `nameOf` answers a hardcoded English "Someone" — which
   * inside an otherwise-Tamil sentence is worse than the gap it fills.
   */
  const who = (memberId: string): string => {
    const member = members.find((person) => person.id === memberId);
    return member ? nameOf(member) : t.budgets.someone;
  };

  /**
   * The days to draw.
   *
   * Normally the timeline's own. The exception is a trip with no dates and
   * nothing on the ledger yet: `buildTimeline` has no days to give, and every
   * add control on this screen lives inside a day — so there would be no way to
   * add the first thing. Today is the day to offer, because a trip being
   * planned from scratch is being planned from now.
   */
  const days =
    timeline.days.length > 0 ? timeline.days : canEdit ? [blankDay(today)] : ([] as TimelineDay[]);

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

      {/* Budgets belong to a trip for the same reason the plan does: a ceiling
          per day means nothing to a flatshare. The RPCs check admin rights and
          membership themselves; hiding the controls only saves somebody a
          refusal. */}
      {canEdit ? (
        <TripBudgets
          currency={currency}
          locale={locale}
          busy={busy}
          canSetOverall={myMember?.role === 'admin'}
          overall={overallBudget}
          memberBudgets={memberBudgets}
          forecasts={forecasts}
          fairness={fairnessSignals}
          nameOf={who}
          onSetOverall={(amountMinor, denomination) =>
            void mutate(() =>
              waves.setGroupBudget({ groupId, amountMinor, currency: denomination }),
            )
          }
          onSetMine={(amountMinor, shared, denomination) =>
            void mutate(() =>
              waves.setMyTripBudget({
                groupId,
                amountMinor,
                currency: denomination,
                visibility: shared ? 'group' : 'private',
              }),
            )
          }
          onClearMine={() => void mutate(() => waves.clearMyTripBudget(groupId))}
        />
      ) : null}

      {timeline.days.length === 0 ? (
        <section className="panel">
          <EmptyState
            Icon={CalendarRange}
            title={canEdit ? t.plan.nothingYet : t.plan.tripsOnly}
            body={canEdit ? t.plan.nothingBody : t.plan.tripsOnlyBody}
          />
        </section>
      ) : null}

      {days.map((day) => (
        <Day
          key={day.day}
          day={day}
          isToday={day.day === today}
          locale={locale}
          busy={busy}
          canEdit={canEdit}
          adding={addingTo === day.day}
          title={title}
          onTitle={setTitle}
          onOpenAdd={() => {
            setAddingTo(day.day);
            setTitle('');
            abandonDraft();
          }}
          onCancelAdd={() => {
            setAddingTo(null);
            setTitle('');
            abandonDraft();
          }}
          onSubmit={() => void submit(day.day)}
          onToggle={(item) => void mutate(() => waves.setPlanItemDone(item.id, !item.done))}
          onRemove={(item) => void mutate(() => waves.removePlanItem(item.id))}
        />
      ))}
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
  canEdit,
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
  /** A plan can only be added to on a trip. See the note on `canEdit`. */
  canEdit: boolean;
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
          {canEdit ? (
            <button
              type="button"
              className="icon-btn"
              onClick={onOpenAdd}
              aria-label={`${t.plan.add} — ${label}`}
            >
              <Plus size={16} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
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
                  disabled={busy || !canEdit}
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
              {canEdit ? (
                <button
                  type="button"
                  className="icon-btn"
                  disabled={busy}
                  onClick={() => onRemove(item)}
                  aria-label={fill(t.plan.remove, { title: item.title })}
                >
                  <X size={15} strokeWidth={2} aria-hidden />
                </button>
              ) : null}
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

/** A day with nothing on it — somewhere to put the first thing. */
function blankDay(day: string): TimelineDay {
  return { day, items: [], expenses: [], plannedByCurrency: {}, spentByCurrency: {} };
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
