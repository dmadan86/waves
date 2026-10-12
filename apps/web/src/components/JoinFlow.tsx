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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { InvitePreview } from '@waves/api-client';
import {
  isAccountRequired,
  isRemovedFromGroup,
  JoinGate,
  joinGate,
  shouldAutoJoin,
} from '@waves/core';

import { SignIn } from '@/components/SignIn';
import { useAuth } from '@/lib/auth';
import { clearAfterSignIn, queueJoinAfterSignIn } from '@/lib/guestSwitch';
import { waves } from '@/lib/waves';
import { fill, plural } from '@/i18n';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';

export function JoinFlow({ token, resume = false }: { token: string; resume?: boolean }) {
  const router = useRouter();

  const { t, locale } = useStrings();
  const { session } = useAuth();
  // Joining a shared group needs an account (ADR-006 amendment, 2026-10-11).
  // There is no guest way in: a signed-out visitor signs up or logs in, and a
  // guest session is asked to create an account (upgrading the identity they
  // have, so what they already hold is kept). `gate` is the one decision.
  const gate = joinGate({
    signedIn: Boolean(session),
    anonymous: session?.user.is_anonymous === true,
  });
  /** Which door the person chose on this page; null while they are reading the invite. */
  const [authMode, setAuthMode] = useState<null | 'sign_in' | 'sign_up'>(null);
  const attempted = useRef(false);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
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
        const accepted = await waves.acceptInvite({
          token,
          claimMemberId: claim,
          displayName: null,
        });

        // Claiming somebody's place only asks now (ADR-006). Routing into the
        // group would land on a page this person cannot read: they are not a
        // member until an admin of the group agrees.
        if (accepted.pending) {
          setPending(true);
          setJoining(false);
          return;
        }
        router.replace(`/g/${accepted.group.id}`);
      } catch (caught) {
        setError(
          isAccountRequired(caught)
            ? t.join.accountRequired
            : isRemovedFromGroup(caught)
              ? t.join.removedFromGroup
              : friendlyError(caught, 'web.join.accept', {
                  fallback: t.errors.couldNotSave,
                  offline: t.errors.offline,
                }),
        );
        setJoining(false);
      }
    },
    [
      token,
      claimId,
      router,
      t.errors.couldNotSave,
      t.errors.offline,
      t.join.accountRequired,
      t.join.removedFromGroup,
    ],
  );

  // The far side of signing up or logging in: finish the join without asking
  // again. Either this page was reloaded by the sign-in (`resume`) or the
  // person chose a door here and the session just appeared.
  const claimableCount = preview?.claimable.length ?? 0;
  useEffect(() => {
    if (
      !preview ||
      !shouldAutoJoin({
        gate,
        resume: resume || authMode !== null,
        claimableCount,
        attempted: attempted.current,
      })
    ) {
      return;
    }
    attempted.current = true;
    void join(null);
  }, [preview, gate, resume, authMode, claimableCount, join]);

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

  // Not yet an account: show the group, say why, and offer the two ways in.
  // The sign-in form is the app's own (same component as the front door); the
  // person is brought back here afterwards and joined.
  if (gate !== JoinGate.Ready) {
    if (authMode) {
      return (
        <SignIn
          initialMode={authMode}
          note={fill(gate === JoinGate.UpgradeGuest ? t.join.guestWhy : t.join.accountWhy, {
            group: groupName,
          })}
          onBack={{
            label: t.join.backToLink,
            run: () => {
              clearAfterSignIn();
              setAuthMode(null);
            },
          }}
        />
      );
    }
    const choose = (mode: 'sign_in' | 'sign_up') => {
      queueJoinAfterSignIn(token);
      setAuthMode(mode);
    };
    return (
      <main className="guest">
        <div className="card">
          <h1>
            {preview.group?.cover_emoji ? `${preview.group.cover_emoji} ` : ''}
            {fill(t.join.addedTo, { group: groupName })}
          </h1>
          <p>{plural(locale, preview.memberCount, t.join.splittingHere)}</p>
          <p className="faint" data-testid="join-account-why">
            {fill(gate === JoinGate.UpgradeGuest ? t.join.guestWhy : t.join.accountWhy, {
              group: groupName,
            })}
          </p>
        </div>
        <button type="button" className="btn block lg" onClick={() => choose('sign_up')}>
          {gate === JoinGate.UpgradeGuest ? t.join.guestUpgrade : t.join.signUpToJoin}
        </button>
        <button type="button" className="btn soft block" onClick={() => choose('sign_in')}>
          {t.join.logIn}
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

      {error ? <p className="error">{error}</p> : null}

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
