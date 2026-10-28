/**
 * One way into a deep-linked screen, for notifications and in-app links.
 *
 * A bare `router.push` onto an empty or Home-only stack leaves the target with
 * nothing sensible under it: Back then exits to the root, which remounts and
 * shows the intro/splash again. `openDeepLink` rebuilds the logical back stack
 * (Home → group → target) instead, and `createOnceGate` makes sure a tapped
 * notification is acted on once, not again every time the root remounts.
 */

/** Where Back goes from `path`, outermost first, then the target itself. */
export function stackForPath(path: string): string[] {
  const clean = path.split(/[?#]/)[0] ?? path;
  const m = /^\/group\/([^/]+)\/.+/.exec(clean);
  // Anything inside a group (expense, settle, company entry, comments…) sits on
  // the group page; the group and everything else sit on Home.
  return m ? [`/group/${m[1]}`, path] : [path];
}

type StackRouter = {
  dismissTo: (href: never) => void;
  push: (href: never) => void;
};

/** Reset to the Home tab root, then push each step so Back walks target → group → Home. */
export function openDeepLink(router: StackRouter, path: string): void {
  try {
    router.dismissTo('/' as never);
  } catch {
    // Navigator not ready: the pushes below still apply.
  }
  for (const step of stackForPath(path)) router.push(step as never);
}

type KV = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
};

const KEY = 'deeplink.lastHandledNotification';

/** True exactly once per id: in memory for the session, persisted for cold start. */
export function createOnceGate(store: KV) {
  const seen = new Set<string>();
  return async function firstTime(id: string): Promise<boolean> {
    if (seen.has(id)) return false;
    seen.add(id);
    try {
      if ((await store.getItem(KEY)) === id) return false;
      await store.setItem(KEY, id);
    } catch {
      // Storage unavailable: the in-memory set still stops repeats this session.
    }
    return true;
  };
}
