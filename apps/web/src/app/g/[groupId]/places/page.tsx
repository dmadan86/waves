'use client';

/**
 * The group's places: every expense that carries a location, as a list out to a
 * map.
 *
 * A plain read of the group's expenses. It lists only what this reader is
 * allowed to see, because RLS dropped the rest before the rows ever arrived,
 * and it never asks for the reader's own location — these are places money was
 * spent, not "where am I".
 *
 * Deliberately not an embedded map, for the same reason the phone's is not: a
 * map needs tiles from somebody, and loading them would hand that third party a
 * list of where this group has been. The phone hands off to the OS maps app;
 * the browser opens Google Maps in a new tab, on a click the reader made.
 *
 * A row therefore has two destinations, so it is two links rather than one — a
 * link inside a link is markup the browser quietly unpicks. The row itself
 * opens the bill, the way every other list in the app opens the thing it lists;
 * the pin beside it opens the map. The pin is a glyph and not a second worded
 * button because a row on a phone has space for one of those and this one has
 * an amount in it already.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MapPin } from 'lucide-react';

import type { Expense, GroupRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { coordLabel, mapsUrl } from '@/lib/geo';
import { money } from '@/lib/money';
import { placesOf } from '@/lib/tripReads';
import { waves } from '@/lib/waves';

export default function PlacesPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';

  return (
    <AppFrame current={Section.Groups}>{() => <Places key={groupId} groupId={groupId} />}</AppFrame>
  );
}

function Places({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [row, bills] = await Promise.all([waves.groupRow(groupId), waves.expenses(groupId)]);
        if (!active) return;
        setGroup(row);
        setExpenses(bills);
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.places.load', {
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

  const places = useMemo(() => placesOf(expenses), [expenses]);

  if (!ready) return <SkeletonRows rows={5} />;
  if (failed) return <p className="error">{failed}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.places.title}</h1>
          {group?.name?.trim() ? <div className="sub">{group.name.trim()}</div> : null}
        </div>
      </div>

      <section className="panel">
        {places.length === 0 ? (
          <EmptyState Icon={MapPin} title={t.places.empty} body={t.places.emptyBody} />
        ) : (
          <div className="list">
            {places.map((place) => (
              <div key={place.id} className="item-pair">
                <Link className="item grow" href={`/g/${groupId}/expense/${place.id}`}>
                  <span className="grow">
                    <span className="title">
                      {place.location.name?.trim() || coordLabel(place.location)}
                    </span>
                    <span className="meta">
                      {place.description.trim() || t.add.defaultDescription}
                    </span>
                  </span>
                  <span className="amount">{money(place.amountMinor, place.currency, locale)}</span>
                </Link>
                {/* A glyph carries no words, and this one leaves the site in a
                    new tab — so the label has to say both which place it is and
                    that it is a map. */}
                <a
                  className="icon-btn"
                  href={mapsUrl(place.location)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${place.location.name?.trim() || coordLabel(place.location)} — ${t.location.openMap}`}
                >
                  <MapPin size={16} strokeWidth={1.75} aria-hidden />
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
