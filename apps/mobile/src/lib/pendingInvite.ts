/**
 * The invite somebody opened before they had an account, kept on the phone so
 * the join can finish after they sign up or log in (ADR-006 amendment,
 * 2026-10-11).
 *
 * Joining a shared group needs an account. The invite screen therefore shows
 * the group and asks for an account first; the person then leaves for the
 * sign-up or login screens (and, for a code by email or an OAuth round trip,
 * may leave the app for a while). This is the note that brings them back.
 *
 * In the keystore rather than plain storage: a join link is a key to a group.
 * It is read once (`take`), because the screen it leads to either completes the
 * join or shows why it could not, and replaying a stale note would surprise.
 * Never allowed to fail loudly: a lost note costs the person one tap on the
 * link again, never a sign-in.
 */
import { secureAuthStorage } from './secureStorage';

const KEY = 'waves.pendingInvite';

/** Long enough for a code by email or an OAuth round trip; short enough that an abandoned one is not applied to whoever signs in next. */
export const PENDING_INVITE_TTL_MS = 2 * 60 * 60 * 1000;

export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PendingInviteStore {
  remember(token: string): Promise<void>;
  /** The remembered token, removed as it is read. Null when none, stale or unreadable. */
  take(): Promise<string | null>;
  /** Whether a fresh invite is waiting, without consuming it. */
  has(): Promise<boolean>;
  clear(): Promise<void>;
}

export function makePendingInviteStore(
  storage: KeyValue,
  now: () => number = Date.now,
): PendingInviteStore {
  const clear = async (): Promise<void> => {
    try {
      await storage.removeItem(KEY);
    } catch {
      // Nothing to do: the worst case is the note expiring on its own.
    }
  };
  return {
    async remember(token) {
      const trimmed = token.trim();
      if (!trimmed) return;
      try {
        await storage.setItem(KEY, JSON.stringify({ token: trimmed, at: now() }));
      } catch {
        // See the header: a lost note costs a tap.
      }
    },
    async take() {
      let raw: string | null = null;
      try {
        raw = await storage.getItem(KEY);
      } catch {
        return null;
      }
      if (!raw) return null;
      await clear();
      try {
        const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown };
        if (typeof parsed.token !== 'string' || parsed.token === '') return null;
        if (typeof parsed.at !== 'number') return null;
        const age = now() - parsed.at;
        if (age < 0 || age > PENDING_INVITE_TTL_MS) return null;
        return parsed.token;
      } catch {
        return null;
      }
    },
    async has() {
      try {
        const raw = await storage.getItem(KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown };
        if (typeof parsed.token !== 'string' || typeof parsed.at !== 'number') return false;
        const age = now() - parsed.at;
        return age >= 0 && age <= PENDING_INVITE_TTL_MS;
      } catch {
        return false;
      }
    },
    clear,
  };
}

export const pendingInvite: PendingInviteStore = makePendingInviteStore(secureAuthStorage);

/** The route that finishes a remembered invite: the join screen, told it is the far side of a sign-in. */
export function resumeRoute(token: string): string {
  return `/join?token=${encodeURIComponent(token)}&resume=1`;
}
