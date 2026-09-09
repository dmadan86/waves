import { SINGLE_ACTION_WINDOW_MS } from '@waves/ui/press';

/**
 * The other half of "one tap, one action" (see `@waves/ui/press`).
 *
 * The tap guard lives on the control, which covers every button built out of
 * the shared kit — but a good number of screens navigate from a bare
 * `Pressable`, a swipe action or a callback that is nowhere near a button. This
 * is the backstop for all of those: the same href, pushed twice inside the same
 * window, is one push.
 *
 * Keyed per method *and* href, never globally: pressing "Settings" and then
 * immediately "Invite" is two different destinations and both must open. And
 * going back clears the record, so leaving a screen and walking straight back
 * into it works — the guard is about a stuttering finger, not about where you
 * are allowed to go.
 *
 * Pure: no expo-router here, so it can be tested without standing up a
 * navigator. `lib/navigation.ts` is the thin wiring that puts it in front of
 * the real router.
 */

export type GuardedNavigation = 'push' | 'navigate' | 'replace' | 'dismissTo';

export interface NavigationGuardOptions {
  windowMs?: number;
  now?: () => number;
}

export interface NavigationGuard {
  /** Whether this navigation should happen. Records it when it should. */
  allow: (method: GuardedNavigation, href: unknown) => boolean;
  /** Forget every recent navigation — what going back does. */
  reset: () => void;
}

/**
 * A stable string for an href, which expo-router accepts as either a path or a
 * `{ pathname, params }` object. Params are sorted so that the same
 * destination written two ways is still recognised as the same destination.
 */
export function hrefKey(href: unknown): string {
  if (typeof href === 'string') return href;
  if (typeof href !== 'object' || href === null) return String(href);

  const { pathname, params } = href as { pathname?: unknown; params?: unknown };
  const path = typeof pathname === 'string' ? pathname : '';
  if (typeof params !== 'object' || params === null) return path;

  const query = Object.entries(params as Record<string, unknown>)
    .map(([key, value]) => [key, String(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return query.length > 0 ? `${path}?${query}` : path;
}

export function createNavigationGuard(options: NavigationGuardOptions = {}): NavigationGuard {
  const windowMs = options.windowMs ?? SINGLE_ACTION_WINDOW_MS;
  const now = options.now ?? Date.now;
  const recent = new Map<string, number>();

  return {
    allow(method, href) {
      const at = now();
      // Sweep first, so the map holds at most the last window's worth of
      // destinations rather than growing for the life of the session.
      for (const [key, when] of recent) {
        if (at - when >= windowMs) recent.delete(key);
      }

      const key = `${method}:${hrefKey(href)}`;
      const last = recent.get(key);
      if (last !== undefined && at - last < windowMs) return false;

      recent.set(key, at);
      return true;
    },
    reset() {
      recent.clear();
    },
  };
}
