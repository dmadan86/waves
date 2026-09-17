'use client';

/**
 * One group, in the full web client.
 *
 * The same balances the phone shows, computed by @waves/core from the same rows
 * (TDR §1): a guest's browser and the payer's phone cannot disagree about who
 * owes what.
 *
 * Three faces, as on the phone — the bills, where everyone stands, and what has
 * happened — because they are three readings of rows already loaded and
 * switching between them should not cost a navigation. The web used to show a
 * flat list of the last thirty expenses and nothing else.
 *
 * What each face is for:
 *
 * **Expenses** is the ledger, cut into months, and each row answers the
 * question somebody actually opens a ledger with — what this bill did to *my*
 * balance, not what it cost the group. The group's total keeps its place in the
 * subtitle. Deleted rows hide behind a switch rather than being dropped: the
 * ledger is append-only and being able to see that is the point.
 *
 * **Balances** is every member's net, then the shortest set of payments that
 * clears them.
 *
 * **Activity** is the group's own trail, read group-scoped rather than filtered
 * out of the dashboard's feed.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, History, Receipt, Scale } from 'lucide-react';

import { myStake } from '@waves/core';
import {
  computeLedger,
  nameOf,
  type ActivityRow,
  type Expense,
  type Group,
  type Member,
  type Settlement,
} from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { SkeletonRows } from '@/components/Skeleton';
import { waves } from '@/lib/waves';
import { money } from '@/lib/money';
import { groupByMonth, monthLabel } from '@/lib/ledgerFeed';
import { describeActivity, VerbIcon } from '@/lib/activity';
import { plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

enum Face {
  Expenses = 'expenses',
  Balances = 'balances',
  Activity = 'activity',
}

export default function GroupPage() {
  return (
    <AppFrame current={Section.Groups}>
      {({ profileId, query }) => <GroupDetail profileId={profileId} query={query} />}
    </AppFrame>
  );
}

function GroupDetail({ profileId, query }: { profileId: string; query: string }) {
  const { t, locale } = useStrings();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [activityFailed, setActivityFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [face, setFace] = useState<Face>(Face.Expenses);
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // The four the ledger cannot be drawn without. The trail is not one of
        // them, so it is fetched beside this rather than inside it: in a single
        // `Promise.all` one rejected activity query took the whole page down to
        // "not your group", which is a sentence that means something else
        // entirely and would have sent somebody to ask why they were removed.
        const [g, m, e, s] = await Promise.all([
          waves.group(groupId),
          waves.members(groupId),
          waves.expenses(groupId),
          waves.settlements(groupId),
        ]);
        if (!active) return;
        setGroup(g);
        setMembers(m);
        setExpenses(e);
        setSettlements(s);
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.group.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [groupId, t.errors.couldNotLoad, t.errors.offline]);

  // The group's trail, on its own errand. Failing it costs the Activity tab and
  // nothing else.
  useEffect(() => {
    let active = true;
    void waves
      .groupActivity(groupId)
      .then((rows) => {
        if (active) setActivity(rows);
      })
      .catch(() => {
        if (active) setActivityFailed(true);
      });
    return () => {
      active = false;
    };
  }, [groupId]);

  // Built once per locale. Constructing an Intl formatter is expensive, and a
  // feed re-runs its headings and its dates on every render.
  const monthFormats = useMemo(
    () => ({
      sameYear: new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }),
      withYear: new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }),
    [locale],
  );
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );

  if (loading) {
    return (
      <div className="app-body">
        <div className="app-main">
          <div className="page-head">
            <span className="sk sk-head" />
          </div>
          <div className="panel">
            <SkeletonRows rows={6} />
          </div>
        </div>
        <aside className="detail">
          <div className="detail-hero">
            <span className="sk sk-avatar" />
            <span className="sk sk-line" style={{ width: 130, margin: '0 auto' }} />
          </div>
        </aside>
      </div>
    );
  }

  // RLS answers "not yours" with no rows rather than an error.
  if (!group) {
    return (
      <div className="app-body">
        <div className="app-main">
          <div className="panel">
            <h2>{t.group.notYours}</h2>
            <p className="muted">{error ?? t.group.notYoursBody}</p>
          </div>
        </div>
        <aside className="detail" />
      </div>
    );
  }

  const currency = group.default_currency;
  const ledger = computeLedger(expenses, settlements, currency);
  const byId = new Map(members.map((member) => [member.id, member]));
  const live = expenses.filter((expense) => !expense.deleted_at && expense.currentVersion);
  const deletedCount = expenses.filter((expense) => expense.deleted_at).length;

  const myMember = members.find((member) => member.profile_id === profileId) ?? null;
  const myMemberId = myMember?.id ?? null;
  const myNet = myMember ? (ledger.balances.get(myMember.id) ?? 0n) : 0n;

  const q = query.trim().toLowerCase();
  const inView = expenses.filter((expense) => {
    if (!expense.currentVersion) return false;
    if (expense.deleted_at && !showDeleted) return false;
    return q ? expense.currentVersion.description.toLowerCase().includes(q) : true;
  });
  const months = groupByMonth(inView);

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <div>
            <h1>
              {group.cover_emoji ? `${group.cover_emoji} ` : ''}
              {group.name?.trim() || t.group.yourGroup}
            </h1>
            <div className="sub">
              {plural(locale, members.length, t.group.peopleCount)} ·{' '}
              {plural(locale, live.length, t.group.expenseCount)}
            </div>
          </div>
          {/* The three places a group leads that are not an expense. They were
              reachable only by typing a URL, which meant a browser could join a
              group and then never invite anybody else to it. */}
          <div className="people">
            <Link className="btn soft" href={`/g/${groupId}/members`}>
              {t.members.title}
            </Link>
            <Link className="btn soft" href={`/g/${groupId}/invite`}>
              {t.invite.title}
            </Link>
            <Link className="btn soft" href={`/g/${groupId}/settings`}>
              {t.groupSettings.title}
            </Link>
            <Link className="btn brand" href={`/g/${groupId}/add`}>
              {t.group.addAnExpense}
            </Link>
          </div>
        </div>

        <SegmentedTabs
          label={t.group.yourGroup}
          value={face}
          onChange={setFace}
          tabs={[
            { value: Face.Expenses, label: t.group.tabExpenses, badge: live.length },
            { value: Face.Balances, label: t.group.tabBalances },
            { value: Face.Activity, label: t.group.tabActivity },
          ]}
        />

        {face === Face.Expenses ? (
          <section
            className="panel"
            role="tabpanel"
            id={`panel-${Face.Expenses}`}
            aria-labelledby={`tab-${Face.Expenses}`}
          >
            {deletedCount > 0 ? (
              <div className="panel-head">
                <h2>{t.group.recent}</h2>
                <button
                  type="button"
                  className="link"
                  onClick={() => setShowDeleted((was) => !was)}
                  aria-pressed={showDeleted}
                >
                  {showDeleted ? t.group.hideDeleted : t.group.showDeleted}
                </button>
              </div>
            ) : null}

            {months.length === 0 ? (
              <EmptyState Icon={Receipt} title={t.group.noneYet} body={t.group.noneYetBody} />
            ) : (
              months.map((month) => (
                <div key={month.key}>
                  {month.date ? (
                    <h3 className="month-head">{monthLabel(monthFormats, month.date)}</h3>
                  ) : null}
                  <div className="list">
                    {month.rows.map((expense) => (
                      <ExpenseRow
                        key={expense.id}
                        expense={expense}
                        groupId={groupId}
                        myMemberId={myMemberId}
                        dayFormat={dayFormat}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        ) : null}

        {face === Face.Balances ? (
          <div
            role="tabpanel"
            id={`panel-${Face.Balances}`}
            aria-labelledby={`tab-${Face.Balances}`}
          >
            <section className="panel">
              <div className="panel-head">
                <h2>{t.group.whereEveryoneStands}</h2>
              </div>
              <div className="list">
                {members.map((member) => {
                  const net = ledger.balances.get(member.id) ?? 0n;
                  const cls = net > 0n ? 'pos' : net < 0n ? 'neg' : 'zero';
                  return (
                    <div key={member.id} className="item" style={{ cursor: 'default' }}>
                      <span className="grow">
                        <span className="title">{nameOf(member)}</span>
                      </span>
                      <span className={`amount ${cls}`}>
                        {net === 0n
                          ? t.group.settledUp
                          : `${net > 0n ? '+' : '−'}${money(net < 0n ? -net : net, currency, locale)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {ledger.transfers.length > 0 ? (
              <section className="panel">
                <div className="panel-head">
                  <h2>{t.group.whoPaysWhom}</h2>
                </div>
                <p className="faint" style={{ marginTop: -6, marginBottom: 10 }}>
                  {t.group.whoPaysWhomNote}
                </p>
                <div className="list">
                  {ledger.transfers.map((transfer, index) => (
                    <div key={index} className="item" style={{ cursor: 'default' }}>
                      <span className="grow">
                        <span className="title transfer">
                          {nameOf(byId.get(transfer.from) ?? fallback(transfer.from))}
                          {/* The direction of a payment, drawn rather than
                              typed: an arrow character points the wrong way in
                              Arabic, where this row reads right to left. */}
                          <ArrowRight
                            size={15}
                            strokeWidth={2}
                            className="transfer-arrow"
                            aria-hidden
                          />
                          {nameOf(byId.get(transfer.to) ?? fallback(transfer.to))}
                        </span>
                      </span>
                      <span className="amount">
                        {money(transfer.amount, transfer.currency, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section className="panel">
                <EmptyState Icon={Scale} title={t.settle.allSettled} />
              </section>
            )}
          </div>
        ) : null}

        {face === Face.Activity ? (
          <section
            className="panel"
            role="tabpanel"
            id={`panel-${Face.Activity}`}
            aria-labelledby={`tab-${Face.Activity}`}
          >
            {activityFailed ? (
              <EmptyState Icon={History} title={t.errors.couldNotLoad} />
            ) : activity === null ? (
              <SkeletonRows rows={6} amount={false} />
            ) : activity.length === 0 ? (
              <EmptyState Icon={History} title={t.activity.empty} />
            ) : (
              <div className="list">
                {activity.map((entry) => {
                  const line = (
                    <>
                      <span className="tile-emoji" aria-hidden>
                        <VerbIcon verb={entry.verb} />
                      </span>
                      <span className="grow">
                        <span className="title wrap">{describeActivity(entry, profileId)}</span>
                        {entry.created_at ? (
                          <span className="meta">
                            {dayFormat.format(new Date(entry.created_at))}
                          </span>
                        ) : null}
                      </span>
                    </>
                  );
                  // A row about an expense opens it, the same rule the
                  // dashboard's feed follows. The rest are not destinations.
                  return entry.object_type === 'expense' && entry.object_id ? (
                    <Link
                      key={entry.id}
                      className="item"
                      href={`/g/${groupId}/expense/${entry.object_id}`}
                    >
                      {line}
                    </Link>
                  ) : (
                    <div key={entry.id} className="item" style={{ cursor: 'default' }}>
                      {line}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>

      <aside className="detail">
        <div className="detail-hero">
          <div className="avatar" aria-hidden>
            {group.cover_emoji ?? '💫'}
          </div>
          <h3>{group.name?.trim() || t.group.yourGroup}</h3>
          <div className="role">{plural(locale, members.length, t.group.peopleCount)}</div>
        </div>

        <div className="detail-field">
          <span className="k">{t.dash.yourNet}</span>
          <span className="v">
            <span className={`amount ${myNet > 0n ? 'pos' : myNet < 0n ? 'neg' : 'zero'}`}>
              {myNet === 0n
                ? t.dash.settledUp
                : `${myNet > 0n ? '+' : '−'}${money(myNet < 0n ? -myNet : myNet, currency, locale)}`}
            </span>
          </span>
        </div>
        <div className="detail-field">
          <span className="k">{t.dash.currencyLabel}</span>
          <span className="v">{currency}</span>
        </div>

        <Link className="btn brand block" href={`/g/${groupId}/add`} style={{ marginTop: 14 }}>
          {t.group.addAnExpense}
        </Link>
      </aside>
    </div>
  );
}

/**
 * One bill, read from the reader's side.
 *
 * The figure on the right is the reader's own stake, not the bill's total —
 * what they put in beyond their share, or their share of what somebody else put
 * in. The total keeps its place in the subtitle, where it is context rather
 * than the answer. The direction is said in words under the figure, so the
 * row's meaning survives for somebody who cannot tell the two money colours
 * apart.
 */
function ExpenseRow({
  expense,
  groupId,
  myMemberId,
  dayFormat,
}: {
  expense: Expense;
  groupId: string;
  myMemberId: string | null;
  dayFormat: Intl.DateTimeFormat;
}) {
  const { t, locale } = useStrings();
  const version = expense.currentVersion;
  if (!version) return null;

  const deleted = Boolean(expense.deleted_at);
  const stake = myStake(version, myMemberId);
  const direction =
    stake === null
      ? t.expense.notInvolved
      : stake > 0n
        ? t.expense.youLent
        : stake < 0n
          ? t.expense.youBorrowed
          : t.group.settledUp;

  const day = dayFormat.format(new Date(version.expense_date));
  const total = money(BigInt(version.amount), version.currency, locale);

  return (
    <Link
      className={`item expense-row${deleted ? ' is-deleted' : ''}`}
      href={`/g/${groupId}/expense/${expense.id}`}
    >
      <span className="grow">
        <span className="title">
          {version.description}
          {deleted ? <span className="pill-badge">{t.expense.deletedBadge}</span> : null}
        </span>
        <span className="meta">{total}</span>
      </span>
      <span className="row-right">
        {stake !== null && stake !== 0n ? (
          <span className={`amount ${stake > 0n ? 'pos' : 'neg'}`}>
            {money(stake < 0n ? -stake : stake, version.currency, locale)}
          </span>
        ) : null}
        <span className="row-meta">
          {direction} · {day}
        </span>
      </span>
    </Link>
  );
}

/** A member who has left is still on old expenses; the transfer still names them. */
function fallback(memberId: string): Member {
  return {
    id: memberId,
    group_id: '',
    profile_id: null,
    ghost_name: null,
    left_at: null,
    profile: null,
  };
}
