'use client';

/**
 * One person, and where the money between you actually sits.
 *
 * The Friends list nets somebody down to one number per currency, which is the
 * right answer to "what do I owe Priya" and the wrong one to "why". A net of
 * ₹200 can be ₹1,200 owed on a trip against ₹1,000 the other way at home, and
 * the pair only settle in the group they belong to — Waves never moves a debt
 * between groups, because the people in one did not agree to the other's.
 *
 * So this page un-collapses: the per-group rows the netting was built from,
 * each with the way to settle that one.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import type { PersonGroupBalanceRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { waves } from '@/lib/waves';
import { money } from '@/lib/money';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export default function PersonPage() {
  return <AppFrame current={Section.Friends}>{() => <Person />}</AppFrame>;
}

function Person() {
  const { t, locale } = useStrings();
  const params = useParams<{ personKey: string }>();
  // The key travels in a URL segment, so it arrives encoded.
  const personKey = decodeURIComponent(params.personKey);

  const [rows, setRows] = useState<PersonGroupBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await waves.personGroupBalances(personKey);
        if (active) setRows(result);
      } catch (caught) {
        if (active)
          setError(
            friendlyError(caught, 'web.person.load', {
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
  }, [personKey, t.errors.couldNotLoad, t.errors.offline]);

  const name = rows[0]?.display_name ?? t.join.someone;
  // Rows that netted to zero in a group are not interesting here: they are the
  // groups you share, squared up, and listing them buries the ones that matter.
  const open = rows.filter((row) => BigInt(row.net) !== 0n);

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <div>
            <h1>{name}</h1>
            <div className="sub">{t.person.acrossGroups}</div>
          </div>
        </div>

        <section className="panel">
          {loading ? (
            <SkeletonRows rows={3} />
          ) : error ? (
            <p className="error">{error}</p>
          ) : open.length === 0 ? (
            <p className="muted">{t.person.squareWith}</p>
          ) : (
            <div className="list">
              {open.map((row) => {
                const net = BigInt(row.net);
                const owed = net > 0n;
                return (
                  <Link
                    key={`${row.group_id}-${row.currency}`}
                    href={`/g/${row.group_id}`}
                    className="item"
                  >
                    <span className="avatar" aria-hidden style={{ width: 38, height: 38 }}>
                      {row.cover_emoji ?? '👥'}
                    </span>
                    <span className="grow">
                      <span className="title">{row.group_name?.trim() || t.join.aGroup}</span>
                      <span className="meta">{owed ? t.friends.owesYou : t.friends.youOwe}</span>
                    </span>
                    <span className={`amount ${owed ? 'pos' : 'neg'}`}>
                      {money(net < 0n ? -net : net, row.currency, locale)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <Link className="btn" href="/settle">
          {t.friends.settleUp}
        </Link>
      </div>
      <aside className="detail" />
    </div>
  );
}
