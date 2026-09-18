'use client';

/**
 * One month of spending, day by day — the way into a column on the chart.
 *
 * Insights answers "what did we spend, month by month". A column there is a
 * total with no way in; this is the way in. Nothing new is summed server-side:
 * it reads the same expenses the group page holds and slices them to the month
 * and currency the tapped column stood for.
 *
 * It honours the scope the chart was in, and that is the part worth being
 * careful about. In group scope a row is the whole expense; in "mine" scope it
 * is this person's share of it, and an expense they had no share in is not
 * shown at all — so the day subtotals and the screen's total add back up to the
 * column that was tapped, and never to a different number.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { CalendarDays } from 'lucide-react';

import type { Expense, GroupRow, Member } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { byDay, drillTotal, isCurrencyCode, monthRows } from '@/lib/monthDrill';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

export default function MonthPage() {
  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => (
        <Suspense fallback={<SkeletonRows rows={5} />}>
          <MonthDrill myProfileId={profileId} />
        </Suspense>
      )}
    </AppFrame>
  );
}

function MonthDrill({ myProfileId }: { myProfileId: string }) {
  const { t, locale } = useStrings();
  const params = useParams<{ groupId: string }>();
  const search = useSearchParams();

  const groupId = params?.groupId ?? '';
  // The column passes the first of the month; the comparison wants 'YYYY-MM'.
  const month = (search.get('month') ?? '').slice(0, 7);
  const currency = search.get('currency') ?? '';
  const mine = search.get('scope') === 'mine';

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [row, people, bills] = await Promise.all([
          waves.groupRow(groupId),
          waves.members(groupId),
          waves.expenses(groupId),
        ]);
        if (!active) return;
        setGroup(row);
        setMembers(people);
        setExpenses(bills);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.month.load', {
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
  }, [groupId, t.errors.couldNotLoad, t.errors.offline]);

  const myMemberId = members.find((member) => member.profile_id === myProfileId)?.id ?? null;

  // The slicing and the day maths are `lib/monthDrill`, tested against the
  // chart's own `monthTotals` — the screen's whole job is to add up to the
  // column that was tapped.
  const rows = useMemo(
    () => monthRows(expenses, { month, currency, mine, myMemberId }),
    [expenses, currency, month, mine, myMemberId],
  );
  const days = useMemo(() => byDay(rows), [rows]);
  const total = drillTotal(rows);

  if (!ready) return <SkeletonRows rows={5} />;
  if (failed) return <p className="error">{failed}</p>;

  // A link somebody typed, shortened or kept from an older build. Formatting
  // money in a currency `Intl` has never heard of throws a RangeError, which
  // takes the whole route down; an unreadable link is an empty month instead.
  if (!isCurrencyCode(currency) || !/^\d{4}-\d{2}$/.test(month)) {
    return (
      <section className="panel">
        <EmptyState
          Icon={CalendarDays}
          title={t.insights.nothingThisMonth}
          body={t.insights.nothingThisMonthBody}
        />
      </section>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{monthTitle(month, locale)}</h1>
          <div className="sub">
            {group?.name}
            {mine ? ` · ${t.insights.justMine}` : ''}
          </div>
        </div>
        <div className="amount" style={{ fontSize: 22 }}>
          {money(total, currency, locale)}
        </div>
      </div>

      {days.length === 0 ? (
        <section className="panel">
          <EmptyState
            Icon={CalendarDays}
            title={t.insights.nothingThisMonth}
            body={t.insights.nothingThisMonthBody}
          />
        </section>
      ) : (
        days.map(([day, bucket]) => (
          <section key={day} className="panel">
            <div className="panel-head">
              <h2>{dayLabel(day, locale)}</h2>
              <span className="amount">{money(bucket.total, currency, locale)}</span>
            </div>
            <div className="list">
              {bucket.items.map(({ expense, amount }) => (
                <Link
                  key={expense.id}
                  className="item"
                  href={`/g/${groupId}/expense/${expense.id}`}
                >
                  <span className="grow">
                    <span className="title">
                      {expense.currentVersion?.description || t.add.defaultDescription}
                    </span>
                  </span>
                  <span className="amount">{money(amount, currency, locale)}</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** 'YYYY-MM' as a month and year, read in UTC. */
function monthTitle(month: string, locale: string): string {
  const [year, monthNo] = month.split('-');
  const start = new Date(Date.UTC(Number(year), Number(monthNo) - 1, 1));
  if (Number.isNaN(start.getTime())) return month;
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(start);
}

/**
 * 'YYYY-MM-DD' as a weekday and date, read from the parts in UTC — so a reader
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
