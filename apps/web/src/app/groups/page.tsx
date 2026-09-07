'use client';

/**
 * Every group, which the browser could reach only by already knowing a URL.
 *
 * The dashboard shows the ones with money moving in them; this is the shelf.
 * Archived groups are included behind a toggle rather than hidden for good —
 * archiving is "off my list", not "deleted", and a trip you archived in March
 * is exactly the thing somebody comes looking for in September.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import type { GroupRow, MemberRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { waves } from '@/lib/waves';
import { plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export default function GroupsPage() {
  return <AppFrame current={Section.Groups}>{({ query }) => <Groups query={query} />}</AppFrame>;
}

function Groups({ query }: { query: string }) {
  const { t, locale } = useStrings();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [members, setMembers] = useState<Map<string, MemberRow[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  /** Bumped by the retry button; re-running the effect is the whole retry. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Everything, archived included: the toggle below is a filter over what
        // is already here, so flipping it is instant rather than a round trip.
        const [rows, byGroup] = await Promise.all([waves.allGroups(), waves.membersByGroup()]);
        if (!active) return;
        setGroups(rows);
        setMembers(byGroup);
        setError(null);
      } catch (caught) {
        // Without this, a failed request reads as "you have no groups" — the
        // most alarming sentence this page could show somebody who has ten.
        if (active)
          setError(
            friendlyError(caught, 'web.groups.load', {
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
  }, [attempt, t.errors.couldNotLoad, t.errors.offline]);

  const q = query.trim().toLowerCase();
  const { live, archived } = useMemo(() => {
    const matching = q
      ? groups.filter((group) => (group.name ?? '').toLowerCase().includes(q))
      : groups;
    return {
      live: matching.filter((group) => !group.archived_at),
      archived: matching.filter((group) => group.archived_at),
    };
  }, [groups, q]);

  const row = (group: GroupRow) => {
    const count = members.get(group.id)?.filter((member) => !member.left_at).length ?? 0;
    return (
      <Link key={group.id} href={`/g/${group.id}`} className="item">
        <span className="avatar" aria-hidden style={{ width: 38, height: 38 }}>
          {group.cover_emoji ?? '👥'}
        </span>
        <span className="grow">
          <span className="title">{group.name?.trim() || t.join.aGroup}</span>
          <span className="meta">
            {plural(locale, count, t.groups.memberCount)}
            {group.archived_at ? ` · ${t.groups.archivedTag}` : ''}
          </span>
        </span>
        <span className="faint">{group.default_currency}</span>
      </Link>
    );
  };

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.groups.title}</h1>
          <Link className="btn" href="/new">
            {t.groups.newGroup}
          </Link>
        </div>

        <section className="panel">
          {loading ? (
            <SkeletonRows rows={5} />
          ) : error ? (
            <>
              <p className="error">{error}</p>
              <button
                type="button"
                className="btn soft"
                onClick={() => {
                  setLoading(true);
                  setAttempt((n) => n + 1);
                }}
              >
                {t.errors.tryAgain}
              </button>
            </>
          ) : live.length === 0 ? (
            <>
              <p className="muted">{t.groups.empty}</p>
              <p className="faint">{t.groups.emptyBody}</p>
            </>
          ) : (
            <div className="list">{live.map(row)}</div>
          )}
        </section>

        <section className="panel" hidden={Boolean(error)}>
          <button type="button" className="btn soft" onClick={() => setShowArchived((on) => !on)}>
            {showArchived ? t.groups.hideArchived : t.groups.showArchived}
          </button>
          {showArchived ? (
            archived.length === 0 ? (
              <p className="faint" style={{ marginBlockStart: 12 }}>
                {t.groups.archivedEmpty}
              </p>
            ) : (
              <div className="list" style={{ marginBlockStart: 12 }}>
                {archived.map(row)}
              </div>
            )
          ) : null}
        </section>
      </div>
      <aside className="detail" />
    </div>
  );
}
