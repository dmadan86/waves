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

const PENDING = 'deeplink.pending';

/** Signed out: keep the target until there is a session to open it with. */
export async function queueDeepLink(store: KV, path: string): Promise<void> {
  try {
    await store.setItem(PENDING, path);
  } catch {
    // Storage unavailable: the tap is lost, nothing worse.
  }
}

/** The queued target, once; empty afterwards. */
export async function takeQueuedDeepLink(store: KV & { removeItem: (k: string) => Promise<void> }) {
  try {
    const path = await store.getItem(PENDING);
    if (path) await store.removeItem(PENDING);
    return path;
  } catch {
    return null;
  }
}

/**
 * Links the OS hands to expo-router (widgets, https/app links, watch) land as a
 * one-screen stack. `redirectSystemPath` notes the target here, and the root
 * re-seats it with `openDeepLink` once the router has arrived on it.
 */
let external: { path: string; at: number } | null = null;
const EXTERNAL_TTL_MS = 15_000;

export function noteExternalLink(url: string, now = Date.now()): void {
  const path = url.replace(/^waves:\/\/\/?/i, '/');
  // Only group screens have a parent to add; re-seating a scan link would replay its one-shot nonce.
  external = path.startsWith('/group/') ? { path, at: now } : null;
}

/** Returns the full target if `pathname` is the one just noted, and clears it. */
export function takeExternalLink(pathname: string, now = Date.now()): string | null {
  const e = external;
  if (!e || now - e.at > EXTERNAL_TTL_MS) return null;
  if ((e.path.split(/[?#]/)[0] ?? e.path) !== pathname) return null;
  external = null;
  return e.path;
}
