'use client';

/**
 * Everything that has happened across every group I am in, newest first.
 *
 * The overview shows the last dozen; this is the whole feed. It reads the same
 * `activity_log` rows the phone does and words each one from the reader's point
 * of view through the shared `describeActivity` (mirrors mobile), so the browser
 * and the app never narrate the same event two different ways. RLS decides which
 * rows come back — there is no group filter here to disagree with it (ADR-013).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import type { ExpenseFigures } from '@/lib/activity';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { waves } from '@/lib/waves';
import { activityAmount, describeActivity, VerbIcon } from '@/lib/activity';
import { buildFeed, loadFeedExtras, type FeedRow } from '@/lib/globalFeed';
import { money } from '@/lib/money';
import { useStrings } from '@/i18n-context';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

export default function ActivityPage() {
  return (
    <AppFrame current={Section.Activity}>
      {({ profileId, query }) => <ActivityFeed profileId={profileId} query={query} />}
    </AppFrame>
  );
}

function ActivityFeed({ profileId, query }: { profileId: string; query: string }) {
  const { t, locale } = useStrings();
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [figures, setFigures] = useState<ExpenseFigures>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const feed = await waves.recentActivity(200);
        if (active) setRows(feed);
        // Comments and names are additions: losing them must not lose the feed.
        try {
          const [extras, byGroup] = await Promise.all([
            loadFeedExtras(feed),
            waves.membersByGroup(),
          ]);
          const built = buildFeed(
            feed,
            extras.comments,
            [...byGroup.values()].flat() as never,
            extras.expenses,
          );
          if (active) {
            setRows(built.rows);
            setNames(built.names);
            setFigures(built.figures);
          }
        } catch {
          /* keep the plain feed */
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter((entry) => describeActivity(entry, profileId, names).toLowerCase().includes(q))
    : rows;

  return (
    <div className="app-body">
      <div className="app-main">
        <div className="page-head">
          <h1>{t.activity.title}</h1>
        </div>

        <section className="panel">
          {loading ? (
            <SkeletonRows rows={7} amount={false} />
          ) : shown.length === 0 ? (
            <EmptyState Icon={Activity} title={t.activity.empty} />
          ) : (
            <div className="list">
              {shown.map((entry) => {
                const figure = activityAmount(entry, figures);
                const line = (
                  <>
                    <span className="tile-emoji" aria-hidden>
                      <VerbIcon verb={entry.verb} />
                    </span>
                    <span className="grow">
                      <span className="title" style={{ fontWeight: 500, whiteSpace: 'normal' }}>
                        {describeActivity(entry, profileId, names)}
                      </span>
                      <span className="meta">{entry.group?.name?.trim() ?? ''}</span>
                    </span>
                    {figure ? (
                      <span className="amount">{money(figure.minor, figure.currency, locale)}</span>
                    ) : null}
                  </>
                );
                // A row about an expense links to it; the rest are not clickable.
                return entry.object_type === 'expense' && entry.object_id ? (
                  <Link
                    key={entry.id}
                    className="item"
                    href={`/g/${entry.group_id}/expense/${entry.object_id}`}
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
      </div>
      <aside className="detail" />
    </div>
  );
}
