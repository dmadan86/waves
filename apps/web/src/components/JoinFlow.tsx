'use client';

/**
 * The link somebody was sent, wherever the token came from.
 *
 * Two routes reach this. `/join/<token>` is the one a person can be given
 * directly; `/join#<token>` is what the app's durable group link looks like
 * (A47), and the difference is not cosmetic — a fragment is never sent to the
 * server, so the token stays out of request logs, proxies and referrer headers
 * on the way in. Both hand the same string to the same screen.
 *
 * The one thing this screen must get right is the claim. Somebody was probably
 * already added as a ghost — "Ravi", typed in by whoever started the group —
 * and the expenses filed against that name are the point of them arriving at
 * all. Taking that place keeps the history; skipping it makes a second Ravi
 * and the group now has two people who are one person, which nothing
 * downstream can undo. So the claim is offered first and by name.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { InvitePreview } from '@waves/api-client';

import { useAuth } from '@/lib/auth';
import { queueJoinAfterSignIn, rememberGuestJoin } from '@/lib/guestSwitch';
import { supabase, waves } from '@/lib/waves';
import { fill, plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export function JoinFlow({ token }: { token: string }) {
  const router = useRouter();

  const { t, locale } = useStrings();
  const { session, signInWithGoogle } = useAuth();
  // Nobody signed in yet: the join would make a guest. Somebody who already
  // has an account is offered it first, so they join as themselves rather than
  // as a guest they later have to switch away from.
  const nobody = !session;

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A claim has been sent and is waiting on an admin of the group. */
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void waves
      .previewInvite(token)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            friendlyError(caught, 'web.join.preview', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      });
    return () => {
      active = false;
    };
  }, [token, t.errors.couldNotLoad, t.errors.offline]);

  /**
   * `claim` is a parameter rather than read from state, because "join as
   * someone new instead" clears the claim and joins in one tap — and the state
   * update is not visible to the call that follows it.
   */
  const join = useCallback(
    async (claim: string | null = claimId) => {
      setError(null);
      setJoining(true);
      try {
        // The guest account is made first, then the invite is accepted against
        // it. Same account when they later add an email, so the group and its
        // history stay theirs rather than being re-joined as a stranger.
        await waves.signInAsGuest();
        const accepted = await waves.acceptInvite({
          token,
          claimMemberId: claim,
          displayName: name.trim() || null,
        });

        // Claiming somebody's place only asks now (ADR-006). Routing into the
        // group would land on a page this person cannot read: they are not a
        // member until an admin of the group agrees.
        if (accepted.pending) {
          setPending(true);
          setJoining(false);
          return;
        }
        // Kept for the guest, so a later sign-in to an account they already
        // have can join this group again as them (`lib/guestSwitch`). Only a
        // join that went through: a claim still waiting on an admin is not a
        // membership, and replaying it would skip the admin's answer.
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (user?.is_anonymous === true) rememberGuestJoin(user.id, token);
        router.replace(`/g/${accepted.group.id}`);
      } catch (caught) {
        setError(
          friendlyError(caught, 'web.join.accept', {
            fallback: t.errors.couldNotSave,
            offline: t.errors.offline,
          }),
        );
        setJoining(false);
      }
    },
    [token, claimId, name, router, t.errors.couldNotSave, t.errors.offline],
  );

  if (error && !preview) {
    return (
      <main className="guest">
        <div className="card">
          <h1>{t.join.linkBroken}</h1>
          {/* The two sentences around this used to have the backend's own
              message wedged between them — "JWT expired", or a row-level
              security sentence — in front of somebody who had done nothing but
              follow a link. They say the whole of what is knowable already. */}
          <p className="faint">{t.join.linkBrokenBody}</p>
        </div>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="guest">
        <div className="card">
          <p className="muted">{t.join.opening}</p>
        </div>
      </main>
    );
  }

  const groupName = preview.group?.name?.trim() || t.join.aGroup;
  const claimedName =
    preview.claimable.find((person) => person.memberId === claimId)?.name ?? t.join.someone;

  if (pending) {
    return (
      <main className="guest">
        <div className="card">
          <h1>{t.join.waitingTitle}</h1>
          <p>{fill(t.join.waitingBody, { group: groupName, name: claimedName })}</p>
        </div>
        <button
          type="button"
          className="btn soft block"
          onClick={() => {
            setClaimId(null);
            setPending(false);
            void join(null);
          }}
          disabled={joining}
        >
          {t.join.joinAsNewInstead}
        </button>
      </main>
    );
  }

  return (
    <main className="guest">
      <div className="card">
        <h1>
          {preview.group?.cover_emoji ? `${preview.group.cover_emoji} ` : ''}
          {fill(t.join.addedTo, { group: groupName })}
        </h1>
        <p>{plural(locale, preview.memberCount, t.join.splittingHere)}</p>
      </div>

      {preview.claimable.length > 0 ? (
        <div className="card">
          <h2>{t.join.whichOneAreYou}</h2>
          <p className="faint">{t.join.claimNote}</p>
          <div className="people">
            {preview.claimable.map((person) => (
              <button
                key={person.memberId}
                type="button"
                className="chip"
                aria-pressed={claimId === person.memberId}
                onClick={() => setClaimId(person.memberId)}
              >
                {person.name ?? t.join.someone}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={claimId === null}
              onClick={() => setClaimId(null)}
            >
              {t.join.noneOfThese}
            </button>
          </div>
        </div>
      ) : null}

      {claimId === null ? (
        <div className="card">
          <h2>{t.join.yourName}</h2>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.join.namePlaceholder}
            aria-label={t.join.yourName}
            autoComplete="name"
          />
          <p className="faint">{t.join.onlyThingAsked}</p>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {nobody ? (
        <button
          type="button"
          className="btn soft block"
          onClick={() => {
            queueJoinAfterSignIn(token);
            void signInWithGoogle();
          }}
          disabled={joining}
        >
          {t.join.signInFirst}
        </button>
      ) : null}

      <button type="button" className="btn block lg" onClick={() => void join()} disabled={joining}>
        {joining
          ? t.join.joining
          : claimId
            ? fill(t.join.askToJoinAs, { name: claimedName })
            : fill(t.join.joinGroup, { group: groupName })}
      </button>
    </main>
  );
}
