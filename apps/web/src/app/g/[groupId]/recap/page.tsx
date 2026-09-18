'use client';

/**
 * Trip recap: the trip, once it is over, in the few numbers people repeat.
 *
 * "We spent ₹84,000, mostly on stays, the biggest single bill was the
 * houseboat, and Ravi fronted the most." Every one of those is already in the
 * ledger — this is the reduction, not a new calculation, and `recap` in
 * `@waves/core` is the same function the phone reads, so the two screens cannot
 * disagree about a trip.
 *
 * The two rules the trip maths obeys hold here too. **Currencies never mix
 * (ADR-004)**: a trip billed in rupees and baht gets a block each and no single
 * total, because there is no honest one without a rate somebody chose. And
 * **nothing is re-divided**: the per-member figure is the money the ledger says
 * that person actually put in.
 *
 * "Fronted the most" is about who *paid*, not who owes — a different question
 * from the balance, and the one people ask at the end of a trip.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import { recap, resolveCategory } from '@waves/core';
import { GroupType, nameOf, type Expense, type GroupRow, type Member } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { plural } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';
import { recapExpenses } from '@/lib/tripReads';
import { waves } from '@/lib/waves';

export default function RecapPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';

  return (
    <AppFrame current={Section.Groups}>{() => <Recap key={groupId} groupId={groupId} />}</AppFrame>
  );
}

function Recap({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Everybody who was ever here, not the present roster: somebody can
        // front the most on a trip and leave the group before it is recapped,
        // and "Someone fronted the most" is exactly the line this screen exists
        // to get right. RLS allows the wider read — the policy is membership of
        // the group, not the reader's own standing in it.
        const [row, people, bills] = await Promise.all([
          waves.groupRow(groupId),
          waves.allMembers(groupId),
          waves.expenses(groupId),
        ]);
        if (!active) return;
        setGroup(row);
        setMembers(people);
        setExpenses(bills);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.recap.load', {
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

  // category id → its display meta, so a custom tag names itself rather than
  // folding into the built-in "Other".
  const metaByCategory = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveCategory>>();
    for (const expense of expenses) {
      const version = expense.currentVersion;
      if (!version || expense.deleted_at || !version.category) continue;
      if (!map.has(version.category)) {
        map.set(version.category, resolveCategory(version.category, version.category_meta ?? null));
      }
    }
    return map;
  }, [expenses]);

  // The selection — live expenses, read by their payers — is `lib/tripReads`,
  // where it is tested. The arithmetic is core's. Nothing is computed here.
  const summary = useMemo(
    () =>
      recap({
        expenses: recapExpenses(expenses),
        startDate: group?.start_date?.slice(0, 10) ?? null,
        endDate: group?.end_date?.slice(0, 10) ?? null,
      }),
    [expenses, group?.start_date, group?.end_date],
  );

  if (!ready) return <SkeletonRows rows={5} />;
  if (failed) return <p className="error">{failed}</p>;

  const categoryLabel = (category: string): string => {
    const resolved = metaByCategory.get(category) ?? resolveCategory(category, null);
    if (resolved.custom) return resolved.label;
    const builtins = t.categories as Record<string, string>;
    return builtins[resolved.builtinId ?? 'other'] ?? resolved.label;
  };

  // A trip can be recapped after somebody has left it, and a name this table
  // cannot find has to be said in the reader's language — `nameOf` answers a
  // hardcoded English "Someone", which inside a Tamil sentence is worse than
  // the gap it fills.
  const who = (memberId: string): string => {
    const member = members.find((row) => row.id === memberId);
    return member ? nameOf(member) : t.join.someone;
  };

  return (
    <div>
      <div className="page-head">
        <div>
          {/* Only a trip is offered this screen, but only the *link* is gated —
              the address still resolves for any group, and every figure below
              is as true of a flatshare as of a fortnight in Goa. So the page
              does not refuse to show correct numbers; it just stops calling
              them a trip's. */}
          <h1>{group?.type === GroupType.Trip ? t.recap.title : t.recap.titleAny}</h1>
          <div className="sub">{group?.name?.trim() || t.recap.subtitle}</div>
        </div>
      </div>

      {summary.byCurrency.length === 0 ? (
        <section className="panel">
          <EmptyState Icon={Sparkles} title={t.recap.noneYet} body={t.recap.subtitle} />
        </section>
      ) : (
        summary.byCurrency.map((block) => (
          <section key={block.currency} className="panel">
            <div className="member-hero">
              <span className="amount standing-amount">
                {money(block.totalMinor, block.currency, locale)}
              </span>
              <span className="meta">
                {plural(locale, block.expenseCount, t.group.expenseCount)}
              </span>
            </div>

            <RecapField
              label={t.recap.perDay}
              value={money(block.dailyAverageMinor, block.currency, locale)}
            />
            {block.biggestExpense ? (
              <RecapField
                label={t.recap.biggestBill}
                // The recap already knows which bill it was, and the browser has
                // a page for it — so the headline is a way in rather than a fact
                // to go and look up.
                detail={
                  <Link
                    className="plain-link"
                    href={`/g/${groupId}/expense/${block.biggestExpense.id}`}
                  >
                    {block.biggestExpense.description.trim() || t.add.defaultDescription}
                  </Link>
                }
                value={money(block.biggestExpense.amountMinor, block.currency, locale)}
              />
            ) : null}
            {block.topCategory ? (
              <RecapField
                label={t.recap.mostSpentOn}
                detail={categoryLabel(block.topCategory.category)}
                value={money(block.topCategory.totalMinor, block.currency, locale)}
              />
            ) : null}
            {block.topPayer ? (
              <RecapField
                label={t.recap.paidMost}
                detail={who(block.topPayer.member)}
                value={money(block.topPayer.paidMinor, block.currency, locale)}
              />
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}

/**
 * One recap line: what it is, what it was, what it came to.
 *
 * The detail sits under the label rather than beside the figure, because it is
 * the answer's subject — "Biggest bill / the houseboat" reads as one thing, and
 * a long restaurant name wraps in its own column instead of shoving the money
 * off the end of the row.
 */
function RecapField({
  label,
  detail,
  value,
}: {
  label: string;
  detail?: React.ReactNode;
  value: string;
}) {
  return (
    <div className="detail-field">
      <span className="k recap-key">
        <span>{label}</span>
        {detail ? <span className="recap-detail">{detail}</span> : null}
      </span>
      <span className="v">{value}</span>
    </div>
  );
}
