/**
 * A session the server has ended (signed out from another phone, revoked,
 * refresh token gone) must not leave this phone writing into a dead session.
 *
 * On an auth rejection we try one refresh. If that fails as revoked, the local
 * session is ended the involuntary way — no `markDeliberateSignOut`, so
 * `sync/retention.ts` keeps the unsent queue — and the door shows a notice.
 */
import { useSyncExternalStore } from 'react';

import { backend } from '@/lib/backend';

let lost = false;
const listeners = new Set<() => void>();
const publish = (next: boolean): void => {
  if (lost === next) return;
  lost = next;
  listeners.forEach((fn) => fn());
};

export const clearSessionLost = (): void => publish(false);
export const hasLostSession = (): boolean => lost;

export function useSessionLost(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => lost,
    () => false,
  );
}

const REJECTED = /invalid jwt|jwt expired|session_not_found|refresh_token_not_found|invalid refresh token|NOT_SIGNED_IN|not authenticated/i;

/** True when the server turned our token down (as opposed to being unreachable). */
export function isAuthRejection(caught: unknown): boolean {
  const e = (caught ?? {}) as { status?: number; message?: string; code?: string; context?: { status?: number } };
  return (
    e.status === 401 ||
    e.context?.status === 401 ||
    REJECTED.test(`${e.code ?? ''} ${e.message ?? ''}`)
  );
}

let inFlight: Promise<boolean> | null = null;

/** Refresh once; if the server says the session is gone, end it. True when ended. */
export function endSessionIfRevoked(): Promise<boolean> {
  inFlight ??= (async () => {
    const { error } = await backend.auth.refreshSession().catch(() => ({ error: null }));
    // No error, or one that never reached the server (offline): the session may still be fine.
    if (!error || !(error.status === 400 || error.status === 401 || error.status === 403 || isAuthRejection(error))) {
      return false;
    }
    publish(true);
    await backend.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return true;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
