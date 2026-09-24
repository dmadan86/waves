/**
 * The invite links a guest account has joined groups through, kept on the phone.
 *
 * Why keep them: a guest who later tries to add a Google or Apple login that
 * already has its own Waves account cannot merge the two — one identity, one
 * account. What they can do is switch to that account, and the groups they
 * came in for should come with them. The link is the only thing that can join
 * the other account to those groups again, so it is remembered here, against
 * the guest that used it.
 *
 * In the keystore rather than plain storage: a join link is a key to a group.
 */
import { secureAuthStorage } from './secureStorage';

/** Plenty for a guest, who can only hold one group; a bound on a bad loop. */
const MAX_TOKENS = 20;

export interface GuestJoinStore {
  read(guestId: string): Promise<string[]>;
  remember(guestId: string, token: string): Promise<void>;
  clear(guestId: string): Promise<void>;
}

export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** SecureStore keys allow letters, digits, `.`, `-` and `_` — a uuid fits. */
const keyFor = (guestId: string) => `waves.guestJoins.${guestId}`;

export function makeGuestJoinStore(storage: KeyValue): GuestJoinStore {
  const read = async (guestId: string): Promise<string[]> => {
    try {
      const raw = await storage.getItem(keyFor(guestId));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && item !== '')
        : [];
    } catch {
      // Unreadable is empty: losing a rejoin is a tap, a thrown sign-in is a wall.
      return [];
    }
  };
  return {
    read,
    async remember(guestId, token) {
      const trimmed = token.trim();
      if (!guestId || !trimmed) return;
      const current = await read(guestId);
      const next = [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, MAX_TOKENS);
      await storage.setItem(keyFor(guestId), JSON.stringify(next));
    },
    async clear(guestId) {
      if (!guestId) return;
      await storage.removeItem(keyFor(guestId));
    },
  };
}

export const guestJoins: GuestJoinStore = makeGuestJoinStore(secureAuthStorage);
