'use client';

/**
 * Where the money went (M5, TDR §8).
 *
 * A different question from the ledger's. "What do I owe" is a balance; this is
 * "what are we spending on", which deserves its own screen rather than another
 * figure on the group page. Free and basic on purpose (ADR-011): what each
 * category cost, and what each month came to.
 *
 * Two things it refuses to do, both inherited from the ledger:
 *
 * **It never converts between currencies.** A trip billed in euros and rupees
 * gets a chart each, because there is no honest single figure without a rate
 * somebody chose (ADR-003).
 *
 * **It never re-divides anything.** The figures are the shares the ledger
 * stored, odd paisa and all. `computeSpendingRows` in `@waves/core` is the
 * local twin of the `waves_group_spending` RPC and the same function the phone
 * reads, so the two screens cannot disagree about a group's spending — and the
 * browser needs no extra request to draw it, because the group's expenses are
 * already here.
 *
 * Scope is the one control: the whole group, or just this reader's share of it.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PieChart } from 'lucide-react';

import {
  categoryTotals,
  computeSpendingRows,
  monthTotals,
  resolveCategory,
  spendingCurrencies,
  spendingTotal,
  type SpendingRow,
} from '@waves/core';
import type { Expense, GroupRow, Member } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { BarList, ColumnChart, type Bar, type Column } from '@/components/SpendingCharts';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

/** How many months fit before a chart stops being readable. */
const MONTHS_SHOWN = 6;

enum Scope {
  Group = 'group',
  Mine = 'mine',
}

export default function InsightsPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';

  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => <Insights key={groupId} groupId={groupId} myProfileId={profileId} />}
    </AppFrame>
  );
}

function Insights({ groupId, myProfileId }: { groupId: string; myProfileId: string }) {
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(Scope.Group);

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
            friendlyError(caught, 'web.insights.load', {
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

  const allRows = useMemo(() => computeSpendingRows(expenses), [expenses]);
  const myMemberId = members.find((member) => member.profile_id === myProfileId)?.id ?? null;

  const rows = useMemo(() => {
    if (scope !== Scope.Mine) return allRows;
    // Somebody with no membership row has no share of anything here, which is
    // an empty chart rather than the group's chart relabelled.
    return myMemberId ? allRows.filter((row) => row.member_id === myMemberId) : [];
  }, [allRows, scope, myMemberId]);

  const groupCurrency = group?.default_currency ?? 'INR';
  const currencies = useMemo(() => spendingCurrencies(rows, groupCurrency), [rows, groupCurrency]);

  if (!ready) return <SkeletonRows rows={6} />;
  if (failed) return <p className="error">{failed}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.insights.title}</h1>
          <div className="sub">{group?.name}</div>
        </div>
      </div>

      <SegmentedTabs
        value={scope}
        onChange={setScope}
        label={t.insights.scopeLabel}
        tabs={[
          { value: Scope.Group, label: t.insights.wholeGroup },
          { value: Scope.Mine, label: t.insights.justMine },
        ]}
      />

      {currencies.length === 0 ? (
        <section className="panel">
          <EmptyState Icon={PieChart} title={t.insights.nothingYet} body={t.insights.nothingBody} />
        </section>
      ) : (
        currencies.map((currency) => (
          <CurrencyCharts
            key={currency}
            groupId={groupId}
            currency={currency}
            scope={scope}
            rows={rows.filter((row) => row.currency === currency)}
            locale={locale}
          />
        ))
      )}
    </div>
  );
}

function CurrencyCharts({
  groupId,
  currency,
  scope,
  rows,
  locale,
}: {
  groupId: string;
  currency: string;
  scope: Scope;
  rows: SpendingRow[];
  locale: string;
}) {
  const { t } = useStrings();

  const total = spendingTotal(rows);

  // The bucketing is core's; what is left here is naming. A custom tag names
  // itself, a built-in is named through the table.
  const bars: Bar[] = useMemo(
    () =>
      categoryTotals(rows).map(({ key, category, meta, value }) => {
        const resolved = resolveCategory(category, meta);
        const builtins = t.categories as Record<string, string>;
        return {
          key,
          label: resolved.custom
            ? resolved.label
            : (builtins[resolved.builtinId ?? 'other'] ?? resolved.label),
          value,
          formatted: money(value, currency, locale),
          tint: resolved.tint,
        };
      }),
    [rows, currency, locale, t.categories],
  );

  const columns: Column[] = useMemo(
    () =>
      monthTotals(rows, MONTHS_SHOWN).map(({ month, value }) => ({
        key: month,
        label: monthLabel(month, locale),
        value,
        formatted: money(value, currency, locale),
        href: `/g/${groupId}/month?month=${month}&currency=${currency}&scope=${scope}`,
      })),
    [rows, locale, currency, groupId, scope],
  );

  return (
    <>
      <section className="panel">
        <div className="member-hero">
          <span className="amount standing-amount">{money(total, currency, locale)}</span>
          <span className="meta">{fill(t.insights.totalIn, { currency })}</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.insights.byCategory}</h2>
        </div>
        <BarList bars={bars} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t.insights.byMonth}</h2>
        </div>
        <p className="faint" style={{ marginTop: -6, marginBottom: 10 }}>
          {t.insights.tapMonth}
        </p>
        <ColumnChart
          columns={columns}
          describe={(column) => `${column.label}, ${column.formatted}`}
        />
      </section>
    </>
  );
}

/**
 * The month's name, read in UTC.
 *
 * The month is a plain 'YYYY-MM-DD'. Reading it with `new Date(...)` applies
 * the reader's timezone and, east of UTC, labels January as December.
 */
function monthLabel(month: string, locale: string): string {
  const [year, monthNumber] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date);
}
