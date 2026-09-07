/**
 * Which routes a person may sit on, and with what session.
 *
 * Two consumers, and they must agree: the `Stack.Protected` groups in the root
 * layout (which make a route unreachable and take its history entries with it
 * when the session flips), and the redirect effect beside them (which catches
 * the routes the layout never lists — expo-router auto-includes every file, so
 * a deep link can land somewhere no `Stack.Screen` names).
 *
 * Kept pure and free of expo-router imports so it can be tested directly.
 */

/**
 * The doors. A signed-out person is allowed to sit on any of them, and a
 * session appearing on one must move them into the app.
 *
 * `welcome` is the gateway a signed-out person lands on. `guest-welcome` is a
 * door too: its Continue mints an anonymous session, and the moment it does,
 * the person belongs in the app. `phone` and `verify-email` are the code
 * screens — the session `verifyOtp` mints must bounce the same way, or somebody
 * sits on a code screen holding a live session with nowhere to go.
 */
export const AUTH_ROUTES = [
  'welcome',
  'sign-in',
  'sign-up',
  'guest-welcome',
  'phone',
  'verify-email',
] as const;

/**
 * Reachable either way, so they belong to neither guard.
 *
 * `join` carries an invite that may arrive before anybody has an account.
 * `language` is offered on the welcome screen. The privacy screen is opened
 * from the Terms & Privacy line on the doorways, and its open-source licenses
 * screen from a row inside it — a signed-out reader tapping either must not be
 * thrown back to `/welcome`.
 */
const OPEN_ROUTES = ['join', 'language'] as const;

/** Sub-routes of `settings` that a signed-out person may open. */
const OPEN_SETTINGS = ['privacy', 'licenses'] as const;

/** True while the given route segments name one of the auth doors. */
export function isAuthRoute(segments: readonly string[]): boolean {
  return (AUTH_ROUTES as readonly string[]).includes(segments[0] ?? '');
}

/** True while the route exists only in local development builds. */
function isDevOnlyRoute(segments: readonly string[]): boolean {
  const [first, second] = segments;
  return first === 'dev' && second === 'local-privacy';
}

/** True while the route is behind a remotely-controlled feature flag. */
function isFlaggedRoute(segments: readonly string[], flags: RouteAccessFlags): boolean {
  const [first] = segments;
  return first === 'paywall' && !flags.paywall;
}

/** Runtime switches that decide whether optional route files are reachable. */
export interface RouteAccessFlags {
  readonly paywall: boolean;
}

/**
 * True while the route is one a signed-out person may sit on.
 *
 * `dev` is `__DEV__`. The local privacy audit must stay reachable after sign-out
 * so the e2e suite can prove private local state was removed — and must never
 * be reachable signed-out in a production build.
 */
export function isPublicRoute(segments: readonly string[], dev: boolean): boolean {
  if (isAuthRoute(segments)) return true;
  const [first, second] = segments;
  if ((OPEN_ROUTES as readonly string[]).includes(first ?? '')) return true;
  if (dev && isDevOnlyRoute(segments)) return true;
  if (first === 'settings' && (OPEN_SETTINGS as readonly string[]).includes(second ?? '')) {
    return true;
  }
  return false;
}

/**
 * True while the current session state is allowed to remain on this route.
 *
 * This is the redirect-side mirror of the Stack groups in the root layout. It
 * covers the files expo-router can auto-include even when no `Stack.Screen` is
 * rendered for them, such as production dev tools and disabled feature routes.
 */
export function isRouteAllowed(
  segments: readonly string[],
  signedIn: boolean,
  dev: boolean,
  flags: RouteAccessFlags,
): boolean {
  if (!dev && isDevOnlyRoute(segments)) return false;
  if (isFlaggedRoute(segments, flags)) return false;
  if (signedIn) return !isAuthRoute(segments);
  return isPublicRoute(segments, dev);
}
