'use client';

/**
 * Finding one person by something you already know about them.
 *
 * Deliberately the narrowest search in the app. One exact email address or one
 * exact phone number, and a result only if that person has left the matching
 * channel discoverable (Settings → How people find you). No name search, no
 * prefix, no browse: anything looser turns the whole user table into something
 * a stranger can walk.
 *
 * The screen never distinguishes "nobody uses that" from "they have turned this
 * off", because the server refuses to. If the two answers looked different, the
 * setting would itself become the oracle it exists to close.
 *
 * What the result does show back is whatever was typed. That is not a leak —
 * you had it a moment ago — and it is how somebody checks they have found the
 * right Priya before splitting a holiday with her.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import type { FoundPerson } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { Section } from '@/components/Shell';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import { channelFor } from '@/lib/lookup';
import { waves } from '@/lib/waves';

type Outcome =
  { state: 'idle' } | { state: 'found'; person: FoundPerson; typed: string } | { state: 'none' };

export default function FindPersonPage() {
  return <AppFrame current={Section.Friends}>{() => <FindPerson />}</AppFrame>;
}

function FindPerson() {
  const { t } = useStrings();

  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const channel = channelFor(query);

  const search = async (): Promise<void> => {
    if (!channel || busy) return;
    const typed = query.trim();
    setBusy(true);
    setError(null);
    setOutcome({ state: 'idle' });
    try {
      const person = await waves.findPerson(channel, typed);
      setOutcome(person ? { state: 'found', person, typed } : { state: 'none' });
    } catch (caught) {
      // The one server refusal worth its own words: the daily ceiling. It is a
      // sentence somebody can act on — tomorrow — where "could not search"
      // would send them to check their connection.
      const raw = caught instanceof Error ? caught.message : '';
      setError(
        raw.includes('LOOKUP_RATE_LIMIT')
          ? t.person.findRateLimited
          : friendlyError(caught, 'web.person.find', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.person.findTitle}</h1>
          <div className="sub">{t.person.findHint}</div>
        </div>
      </div>

      <section className="panel">
        <form
          className="plan-add"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            className="split-input ltr"
            type="search"
            value={query}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            aria-label={t.person.findPlaceholder}
            placeholder={t.person.findPlaceholder}
            onChange={(event) => {
              setQuery(event.target.value);
              // A stale result under a changed box reads as the answer to the
              // new question. Clear it the moment the question changes.
              setOutcome({ state: 'idle' });
              setError(null);
            }}
          />
          <button type="submit" className="btn brand" disabled={!channel || busy}>
            {t.person.findAction}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}

        {/* One sentence for both refusals, because the server gives one answer. */}
        {outcome.state === 'none' ? (
          <div className="promo-result">
            <Search size={18} strokeWidth={1.75} aria-hidden />
            <span className="grow">
              <span className="title">{t.person.findNoMatch}</span>
              <span className="meta">{t.person.findNoMatchBody}</span>
            </span>
          </div>
        ) : null}

        {outcome.state === 'found' ? <Found person={outcome.person} typed={outcome.typed} /> : null}
      </section>
    </div>
  );
}

/**
 * The person, and the honest next step.
 *
 * Somebody you already share a group with has a page of balances worth opening.
 * Somebody you do not has nothing there yet — routing to it would greet a
 * stranger with "you are square", which is true only in the way that an empty
 * ledger is. So that case offers the thing that actually starts a split.
 */
function Found({ person, typed }: { person: FoundPerson; typed: string }) {
  const { t } = useStrings();

  const identity = (
    <>
      {/* The initial, as everywhere else people are listed here. A found
          person's avatar would be the one thing this screen showed that the
          searcher did not already have. */}
      <span className="avatar" aria-hidden style={{ width: 38, height: 38 }}>
        {person.display_name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      <span className="grow">
        <span className="title">{person.display_name}</span>
        {/* What was typed, given back. It reveals nothing — you had it a moment
            ago — and it is the only way to be sure this is the right person. */}
        <span className="meta ltr">{typed}</span>
      </span>
    </>
  );

  if (person.already_shared) {
    return (
      <Link className="item" href={`/friends/${encodeURIComponent(person.profile_id)}`}>
        {identity}
        {/* Under the name, not beside it. Beside it, at phone width, the badge
            took the row and left "Priy…" — and the name is the whole reason
            somebody is looking at this card. */}
        <span className="pill-badge shared">{t.person.alreadyShared}</span>
      </Link>
    );
  }

  return (
    <>
      <div className="item">{identity}</div>
      <p className="faint">{t.person.notSharedYet}</p>
      <Link className="btn brand" href="/new">
        {t.person.startGroup}
      </Link>
    </>
  );
}
