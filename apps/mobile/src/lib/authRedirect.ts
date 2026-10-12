import { isRouteAllowed, type RouteAccessFlags } from './routeAccess';

/**
 * What the root layout's session guard should do this render.
 *
 * - `wait`: hold the spinner; not enough is known yet.
 * - `stay`: render the app tree as it is.
 * - `welcome` / `home`: replace the route (signed out / signed in).
 *
 * The case this exists for: on a cold start the router has no route state until
 * the navigator mounts, so `segments` is `[]`. `[]` is not a public route, so a
 * signed-out person was redirected to `/welcome` before the launch URL (an
 * invite) was ever applied, and the invite was lost. While the launch URL is
 * unread we wait; once it is known to exist and `segments` is still empty, the
 * navigator must be allowed to mount and resolve it, so we stay. The guard
 * then judges the real route.
 *
 * `initialUrl`: `undefined` while still being read, `null` for a launch with no
 * link, otherwise the link.
 */
export type AuthRedirect = 'wait' | 'stay' | 'welcome' | 'home';

export function decideAuthRedirect(input: {
  segments: readonly string[];
  loading: boolean;
  signedIn: boolean;
  dev: boolean;
  flags: RouteAccessFlags;
  initialUrl: string | null | undefined;
}): AuthRedirect {
  const { segments, loading, signedIn, dev, flags, initialUrl } = input;
  if (loading) return 'wait';
  if (segments.length === 0) {
    if (initialUrl === undefined) return 'wait';
    if (initialUrl !== null) return 'stay';
  }
  if (isRouteAllowed(segments, signedIn, dev, flags)) return 'stay';
  return signedIn ? 'home' : 'welcome';
}
