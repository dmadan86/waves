'use client';

/**
 * One person, inside one group.
 *
 * The members list answers "who is here" and lets an admin change a role. It
 * does not answer the question somebody actually opens a person for: what do
 * they owe or get, and which bills are they on. That was the phone's screen
 * only, so a group read in a browser could tell you Asha was a member and
 * nothing else about her.
 *
 * The balance is the group ledger's own figure for this member, not a sum
 * computed here — the same map the balances tab reads, so the two cannot
 * disagree about the same person. Their bills are the ones they are a party
 * to, payer or sharer, each carrying what the bill did to *them* rather than
 * what it cost the group: `myStake` for this member, which is the figure the
 * ledger rows already speak.
 *
 * Managing a person stays on the members list. Two screens offering the same
 * irreversible controls is two places to get them wrong, and the list is where
 * somebody goes to change who is what.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Receipt } from 'lucide-react';

import { myStake } from '@waves/core';
import {
  computeLedger,
  nameOf,
  type Expense,
  type GroupRow,
  type Member,
  type Settlement,
} from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill, plural } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

/** The bill's own date, read in UTC — a bill dated the 1st is the 1st. */
function billDate(locale: string, iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(parsed));
}

export default function MemberPage() {
  const params = useParams<{ groupId: string; memberId: string }>();
  const groupId = params?.groupId ?? '';
  const memberId = params?.memberId ?? '';

  return (
    <AppFrame current={Section.Groups}>
      {({ profileId }) => (
        // Keyed, so opening a second person from this one resets the read
        // rather than showing the first person's bills under the second's name.
        <MemberDetail
          key={memberId}
          groupId={groupId}
          memberId={memberId}
          myProfileId={profileId}
        />
      )}
    </AppFrame>
  );
}

function MemberDetail({
  groupId,
  memberId,
  myProfileId,
}: {
  groupId: string;
  memberId: string;
  myProfileId: string;
}) {
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [row, people, bills, settled] = await Promise.all([
          waves.groupRow(groupId),
          // Everybody who has ever been here: a departed member still has a
          // history, and this is the screen for reading it.
          waves.allMembers(groupId),
          waves.expenses(groupId),
          waves.settlements(groupId),
        ]);
        if (!active) return;
        setGroup(row);
        setMembers(people);
        setExpenses(bills);
        setSettlements(settled);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.member.load', {
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

  if (!ready) return <SkeletonRows rows={5} />;
  if (failed) return <p className="error">{failed}</p>;

  const member = members.find((row) => row.id === memberId);
  if (!member || !group) {
    return <EmptyState Icon={Receipt} title={t.person.notFound} body={t.person.notFoundBody} />;
  }

  const currency = group.default_currency ?? 'INR';
  const ledger = computeLedger(expenses, settlements, currency);
  const balance = ledger.balances.get(memberId) ?? 0n;
  const isMe = member.profile_id === myProfileId;

  // The bills this person is a party to, newest first, each with what it did to
  // them. A bill they are on for nothing — written into the split with a zero
  // share — is still a bill they are on, which `myStake` answers null for; the
  // row shows the date and no figure rather than a misleading zero.
  const theirs = expenses
    .filter((expense) => !expense.deleted_at && expense.currentVersion)
    .filter((expense) => {
      const version = expense.currentVersion;
      if (!version) return false;
      return (
        version.payers.some((row) => row.member_id === memberId) ||
        version.shares.some((row) => row.member_id === memberId)
      );
    })
    .sort((a, b) =>
      (b.currentVersion?.expense_date ?? '').localeCompare(a.currentVersion?.expense_date ?? ''),
    );

  return (
    <div>
      <section className="panel">
        <div className="panel-head">
          <h2>{nameOf(member)}</h2>
        </div>

        <div className="member-hero">
          <span
            className={`amount hero-amount ${balance > 0n ? 'pos' : balance < 0n ? 'neg' : 'zero'}`}
          >
            {balance === 0n
              ? t.group.settledUp
              : money(balance < 0n ? -balance : balance, currency, locale)}
          </span>
          {balance !== 0n ? (
            <span className="meta">
              {/* Said from the reader's side of the table: this person is owed,
                  or owes, the group. */}
              {balance > 0n ? t.group.isOwed : t.group.owes}
            </span>
          ) : null}

          <span className="badges">
            {isMe ? <span className="chip">{t.person.you}</span> : null}
            {member.role === 'admin' ? <span className="chip">{t.person.admin}</span> : null}
            {member.profile_id === null ? (
              <span className="chip">{t.person.notJoinedYet}</span>
            ) : null}
            {member.left_at ? <span className="chip">{t.person.left}</span> : null}
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{plural(locale, theirs.length, t.person.onCount)}</h2>
        </div>

        {theirs.length === 0 ? (
          <p className="meta">{fill(t.person.noneHere, { name: nameOf(member) })}</p>
        ) : (
          <div className="list">
            {theirs.map((expense) => {
              const version = expense.currentVersion;
              if (!version) return null;
              const stake = myStake(version, memberId);
              return (
                <Link
                  key={expense.id}
                  className="item"
                  href={`/g/${groupId}/expense/${expense.id}`}
                >
                  <span className="grow">
                    <span className="title">{version.description || t.add.defaultDescription}</span>
                    <span className="meta">
                      {version.expense_date ? billDate(locale, version.expense_date) : ''}
                    </span>
                  </span>
                  <span
                    className={`amount ${stake === null ? 'zero' : stake > 0n ? 'pos' : stake < 0n ? 'neg' : 'zero'}`}
                  >
                    {stake === null || stake === 0n
                      ? money(BigInt(version.amount), version.currency, locale)
                      : money(stake < 0n ? -stake : stake, version.currency, locale)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
