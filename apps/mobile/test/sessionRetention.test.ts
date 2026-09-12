/**
 * What the end of a session is allowed to destroy.
 *
 * The bug being pinned here destroyed people's records without anybody asking:
 * the wipe ran on "the session became null", and a refresh token revoked, or
 * expired past recovery, or rejected by a server that had moved, arrives at
 * that condition looking exactly like somebody tapping sign out. It took
 * `pending_mutations` with it — an expense entered in a dead zone, which by
 * definition nobody else has a copy of — and then the key that could have
 * opened them.
 *
 * So most of this file is about the difference between the two endings, and the
 * assertions that matter are the ones nobody would notice failing until a real
 * phone lost a real day's expenses. Every branch is a sentence about whether
 * somebody's records still exist.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  destroyedBy,
  forgetSignOutMark,
  markDeliberateSignOut,
  Retention,
  RETENTION_WINDOW_MS,
  retentionExpired,
  retentionVerdict,
  SessionEnd,
  takeSessionEnd,
  type RetainedWork,
} from '../src/sync/retention';

const ANA = 'ana-0000-0000-0000-000000000001';
const BEN = 'ben-0000-0000-0000-000000000002';

const NOW = Date.parse('2026-09-12T10:00:00.000Z');
const held = (overrides: Partial<RetainedWork> = {}): RetainedWork => ({
  ownerId: ANA,
  retainedAt: new Date(NOW - 60_000).toISOString(),
  ...overrides,
});

beforeEach(() => {
  forgetSignOutMark();
});

describe('a sign-out somebody asked for', () => {
  it('still destroys everything, the key included', () => {
    // The security property. Signing out must leave nothing readable on this
    // phone, the crypto-erase is what makes ciphertext in the WAL and the free
    // list unrecoverable, and the sheet in front of the button says exactly
    // this is about to happen. None of it is softened by the change.
    expect(destroyedBy(SessionEnd.SignedOut)).toEqual({
      mirror: true,
      unsent: true,
      credentials: true,
      cache: true,
      key: true,
    });
  });

  it('is what deleting the account gets, because deletion signs out', () => {
    // `settings/delete-account` erases server-side and then calls the same
    // `signOut`, so the marked, deliberate ending is the one it reaches. There
    // is no second path and there must not be one: an account that no longer
    // exists has nothing to come back for.
    markDeliberateSignOut(NOW);
    expect(destroyedBy(takeSessionEnd(NOW))).toEqual(destroyedBy(SessionEnd.SignedOut));
  });
});

describe('a session that ended without anybody asking', () => {
  it('keeps the unsent work and the key that opens it', () => {
    const scope = destroyedBy(SessionEnd.Lost);
    // The whole point. A revoked token is not somebody asking to be forgotten,
    // and the queue and the drafts have reached nobody.
    expect(scope.unsent).toBe(false);
    expect(scope.key).toBe(false);
  });

  it('still drops the ledger the server is holding anyway', () => {
    // The privacy half of the trade: a readable mirror on a phone nobody is
    // signed into is cost without benefit, because the next sign-in re-pulls
    // every row of it. Same for the downloaded images.
    const scope = destroyedBy(SessionEnd.Lost);
    expect(scope.mirror).toBe(true);
    expect(scope.cache).toBe(true);
  });

  it('keeps the backup credentials, which are also a single copy', () => {
    // The recovery key exists in one keystore in the world. Destroying it
    // because a token expired would be the same class of bug as destroying the
    // queue — an irreversible loss triggered by an event nobody chose.
    expect(destroyedBy(SessionEnd.Lost).credentials).toBe(false);
  });
});

describe('the key and the data it opens', () => {
  it('are never separated, whichever way the session ended', () => {
    // Two nonsense states this guards: a queue kept under a destroyed key is a
    // queue nobody can read, and a key kept over a destroyed queue is a
    // crypto-erase that erased nothing. `key` must track `unsent` exactly.
    for (const reason of [SessionEnd.SignedOut, SessionEnd.Lost]) {
      const scope = destroyedBy(reason);
      expect(scope.key).toBe(scope.unsent);
    }
  });
});

describe('which ending it was', () => {
  it('is involuntary unless somebody marked it', () => {
    // The default has to be the safe one. Every path that is not `signOut` —
    // and there are four of them inside supabase-js alone — lands here.
    expect(takeSessionEnd(NOW)).toBe(SessionEnd.Lost);
  });

  it('is deliberate for the sign-out that marked it', () => {
    markDeliberateSignOut(NOW);
    expect(takeSessionEnd(NOW + 50)).toBe(SessionEnd.SignedOut);
  });

  it('spends the mark, so one sign-out cannot wipe twice', () => {
    markDeliberateSignOut(NOW);
    expect(takeSessionEnd(NOW)).toBe(SessionEnd.SignedOut);
    expect(takeSessionEnd(NOW)).toBe(SessionEnd.Lost);
  });

  it('goes stale, so a sign-out that failed cannot arm a later loss', () => {
    // `signOut` can throw before the session actually ends. The mark left
    // behind must not be spent by a revoked token ten minutes later — that
    // would be this bug again, wearing a disguise.
    markDeliberateSignOut(NOW);
    expect(takeSessionEnd(NOW + 10 * 60_000)).toBe(SessionEnd.Lost);
  });

  it('is dropped when a session starts', () => {
    markDeliberateSignOut(NOW);
    forgetSignOutMark();
    expect(takeSessionEnd(NOW)).toBe(SessionEnd.Lost);
  });
});

describe('who may have the work that was kept', () => {
  it('is the account that made it, coming back', () => {
    expect(retentionVerdict(held(), ANA, NOW)).toBe(Retention.Adopt);
  });

  it('is never anybody else', () => {
    // The one that must never be got wrong. Draining Ana's queue under Ben's
    // session would post her spending into whatever groups he can reach — a
    // worse outcome than the loss this whole change prevents.
    expect(retentionVerdict(held(), BEN, NOW)).toBe(Retention.Discard);
  });

  it('is nobody at all when the hold cannot say whose it is', () => {
    // An empty owner is not a wildcard. Unattributable data is discarded.
    expect(retentionVerdict(held({ ownerId: '' }), '', NOW)).toBe(Retention.Discard);
  });

  it('is not asked when nothing is being held', () => {
    // The common case, and it must not turn into a wipe: a phone that has never
    // lost a session has no stamp, and finding none is not a reason to delete.
    expect(retentionVerdict(null, ANA, NOW)).toBe(Retention.Nothing);
  });

  it('is nobody once the window has passed', () => {
    const stale = held({ retainedAt: new Date(NOW - RETENTION_WINDOW_MS - 1).toISOString() });
    expect(retentionVerdict(stale, ANA, NOW)).toBe(Retention.Discard);
  });
});

describe('how long a hold may sit', () => {
  it('survives right up to the window', () => {
    const almost = held({ retainedAt: new Date(NOW - RETENTION_WINDOW_MS + 1000).toISOString() });
    expect(retentionExpired(almost, NOW)).toBe(false);
  });

  it('expires at it', () => {
    const exactly = held({ retainedAt: new Date(NOW - RETENTION_WINDOW_MS).toISOString() });
    expect(retentionExpired(exactly, NOW)).toBe(true);
  });

  it('expires when the stamp will not parse', () => {
    // A date nobody can read is not a claim on the disk.
    expect(retentionExpired(held({ retainedAt: 'sometime' }), NOW)).toBe(true);
  });

  it('does not expire on a clock that has run backwards', () => {
    // A phone whose clock is wrong is not a reason to destroy somebody's
    // unsent expenses. The window catches it once the clock is right.
    const future = held({ retainedAt: new Date(NOW + 5 * 60_000).toISOString() });
    expect(retentionExpired(future, NOW)).toBe(false);
  });
});
