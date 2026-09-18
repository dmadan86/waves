'use client';

/**
 * Say that two guests are one person.
 *
 * A guest appears once per group, because a name is no proof that the "Alex" in
 * one group is the "Alex" in another. This screen records the one thing that
 * *is* proof: a person saying so. The merge is per-viewer and never rewrites
 * the ledger — each group keeps its own guest and its own balance, and only the
 * Friends aggregation folds them under one name.
 *
 * It is presented as permanent, because it is: there is no un-merge, and the
 * screen says so in as many words above the button rather than in a toast
 * afterwards.
 *
 * Only guests are offered. A real person is already one identity across every
 * group by their account, so folding them under a made-up name would be a lie;
 * the RPC refuses it too, and keeping them off the list means nobody is offered
 * a choice the server will reject.
 *
 * Who is offered comes from group membership, not from balances: a guest is
 * mergeable whether or not they owe anything today, and the balance list drops
 * everybody who is square — including, typically, the one you are merging into.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import {
  canMerge,
  guestsFrom,
  memberIdsFor,
  mergeRefusal,
  suggestedName,
  type Guest,
} from '@/lib/mergePeople';
import { waves } from '@/lib/waves';

export default function MergePeoplePage() {
  return <AppFrame current={Section.Friends}>{() => <MergePeople />}</AppFrame>;
}

function MergePeople() {
  const { t, locale } = useStrings();
  const router = useRouter();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [picked, setPicked] = useState<string[]>([]);
  /** Null until somebody types: an untouched field follows the suggestion. */
  const [typedName, setTypedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [members, merges] = await Promise.all([waves.mergeableGuests(), waves.ghostMerges()]);
        if (active) setGuests(guestsFrom(members, merges, t.join.someone));
      } catch (caught) {
        if (active)
          setLoadError(
            friendlyError(caught, 'web.merge.load', {
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
  }, [t.errors.couldNotLoad, t.errors.offline, t.join.someone]);

  const chosen = useMemo(
    () => guests.filter((guest) => picked.includes(guest.key)),
    [guests, picked],
  );
  // The suggestion follows the picks until somebody overrides it; after that it
  // is theirs, and a later tick must not quietly rewrite what they typed.
  const name = typedName ?? suggestedName(chosen);
  const ready = canMerge(chosen, name) && !saving;

  const toggle = (key: string): void => {
    setError(null);
    setPicked((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const merge = async (): Promise<void> => {
    if (!ready) return;
    setError(null);
    setSaving(true);
    try {
      await waves.mergeGhosts(memberIdsFor(chosen), name.trim());
      router.replace('/friends');
    } catch (caught) {
      // Each refusal is a different thing to go and do, so each keeps its own
      // sentence; the raw message names tables and never reaches the page.
      setError(mergeRefusal(caught, t.mergePeople));
      setSaving(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadError) return <p className="error">{loadError}</p>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.mergePeople.title}</h1>
          <div className="sub">{t.mergePeople.subtitle}</div>
        </div>
      </div>

      {guests.length === 0 ? (
        <section className="panel">
          <EmptyState Icon={Users} title={t.mergePeople.empty} />
        </section>
      ) : (
        <>
          <section className="panel">
            {guests.map((guest) => (
              <label className="field row-field" key={guest.key}>
                <input
                  type="checkbox"
                  checked={picked.includes(guest.key)}
                  disabled={saving}
                  onChange={() => toggle(guest.key)}
                />
                <span className="grow">
                  <span className="title">{guest.name}</span>
                  <span className="meta">
                    {plural(locale, guest.groupCount, t.mergePeople.inGroups)}
                    {/* Said out loud because it is what makes one of two names
                        the one you actually know them by. */}
                    {guest.hasContact ? ` · ${t.mergePeople.hasContact}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>{plural(locale, chosen.length, t.mergePeople.selected)}</h2>
            </div>

            <label className="field">
              <span className="field-label">{t.mergePeople.nameLabel}</span>
              <input
                value={name}
                disabled={saving}
                autoComplete="off"
                placeholder={t.mergePeople.namePlaceholder}
                onChange={(event) => setTypedName(event.target.value)}
              />
            </label>

            {/* Before the button, not after it. There is no un-merge. */}
            <div className="promo-result">
              <span className="grow">
                <span className="title">{t.mergePeople.warningTitle}</span>
                <span className="meta">{t.mergePeople.warningBody}</span>
              </span>
            </div>

            {error ? <p className="error">{error}</p> : null}

            <button
              type="button"
              className="btn brand"
              disabled={!ready}
              onClick={() => void merge()}
            >
              {t.mergePeople.cta}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
