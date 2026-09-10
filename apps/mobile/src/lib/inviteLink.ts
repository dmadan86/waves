/**
 * Reading a Waves invite link, with nothing native anywhere near it.
 *
 * This is the one parser for the three shapes a join link has ever had. It used
 * to live in `qrScan.ts` beside the camera check, which was fine while the only
 * caller was the scanner — but the link now also arrives as an Android App Link,
 * and that is handled in `app/+native-intent.ts`, which runs before the app
 * context exists. Importing the camera module's file from there would pull
 * `expo` and `react-native` into the cold launch to reach a pure string
 * function.
 *
 * So the parsing lives here, importing only `INVITE_HOST` (which reads an env
 * var and nothing else), and `qrScan` re-exports it. One parser, two doors: a
 * link the scanner accepts and a link the OS hands over are read by the same
 * code, and cannot drift into disagreeing about which group an invite names.
 */

import { INVITE_HOST } from '@/lib/webUrl';

/** The app's own deep-link schemes, the non-https half of the allowlist. */
const INVITE_SCHEMES = new Set(['waves']);

/**
 * The three shapes a Waves join link has ever had, in the order a token is
 * looked for.
 *
 *  - `#<token>` — what `groupJoinLink` writes today, and the only shape the
 *    invite screen paints as a QR. The token lives in the fragment on purpose:
 *    a fragment is never sent to a server, so it stays out of access logs,
 *    proxies and `Referer` headers on the way to the web join page.
 *  - `/join/<token>` — the older path form, which the web app still serves
 *    (`apps/web/src/app/join/[token]`).
 *  - `?token=<token>` — the older query form. Still handled because a link
 *    pasted out of an old chat thread is exactly the case this screen is for.
 *
 * Fragment first, because that is the shape the app emits and the only shape
 * the web actually honours: `apps/web/src/app/join/page.tsx` reads
 * `window.location.hash` and never looks at the query at all. Reading the query
 * first would make one link mean two different groups — `…/join?token=A#B`
 * would join B in a browser and A on the phone — which is precisely the gap
 * somebody splicing a `?token=` into a link they forwarded would be reaching
 * for.
 *
 * And when two shapes are both present and disagree, no token is returned at
 * all. See `tokenFromScan`.
 */

/** The part of an https invite path that follows `/join`: `''` for the join
 *  root itself, the trailing segment for the path form, null for anything that
 *  is not a join URL at all. The match on `/join` is exact so
 *  `https://…/x/join` is not mistaken for one. */
function afterJoin(path: string): string | null {
  if (path === '/join') return '';
  if (path.startsWith('/join/')) return path.slice('/join/'.length);
  return null;
}

/**
 * Whether this URL is one of ours, and what its path carries past `/join`.
 *
 * `INVITE_HOST` comes from `@/lib/webUrl` — the same constant `groupJoinLink`
 * builds outgoing links from, so this allowlist can never point somewhere
 * different than the app's own invites do.
 */
function joinRemainder(parsed: URL): string | null {
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '') || '/';

  if (scheme === 'https') {
    if (host !== INVITE_HOST) return null;
    return afterJoin(path);
  }
  if (!INVITE_SCHEMES.has(scheme)) return null;
  // `waves://join/…` parses with `join` as the host and the token alone in the
  // path; `waves:///join/…` parses with an empty host and `join` as the first
  // path segment. Do not accept an arbitrary host just because its path is
  // `/join` — `waves://evil.example/join` is not our link.
  if (host === 'join') return path === '/' ? '' : path.slice(1);
  if (host === '') return afterJoin(path);
  return null;
}

/** A candidate token as the person can actually use it: decoded when that is
 *  possible, trimmed, and null rather than empty. Malformed percent-encoding
 *  keeps the raw value — the server is the judge of whether a token exists, and
 *  a decode that throws is not proof that it does not. */
function cleanToken(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const decoded = decodeURIComponent(trimmed).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return trimmed;
  }
}

/**
 * The invite token out of whatever the camera read — or out of a link somebody
 * pasted, which is the same problem.
 *
 * Only a join URL on the app's own host (or one of its deep-link schemes) is
 * trusted; a random QR from a poster is not an invite, and returns null so the
 * screen can say so rather than routing nowhere.
 */
export function tokenFromScan(data: string): string | null {
  const text = data.trim();
  if (!text) return null;

  // The fragment is read off the raw string rather than from `URL.hash`,
  // because the fragment is where today's links keep the token and the
  // polyfilled `URL` in React Native is only trusted here for the origin and
  // the path. Splitting first also means a fragment can never be read as part
  // of the query below.
  const hashAt = text.indexOf('#');
  const fragment = hashAt === -1 ? '' : text.slice(hashAt + 1);
  const withoutFragment = hashAt === -1 ? text : text.slice(0, hashAt);

  let parsed: URL;
  try {
    parsed = new URL(withoutFragment);
  } catch {
    return null;
  }

  const remainder = joinRemainder(parsed);
  if (remainder === null) return null;
  // A token is one path segment. `/join/a/b` is some other page of ours, not an
  // invite carrying a token with a slash in it.
  if (remainder.includes('/')) return null;

  // Read the query off the raw search string rather than `searchParams`, whose
  // support is patchy in the React Native URL polyfill.
  const queried = parsed.search.match(/[?&]token=([^&]+)/)?.[1];

  // Fragment, then path, then query — and a shape that cleans away to nothing
  // (`?token=%20%20`) counts as absent rather than as an empty answer, so a
  // chat client that rewrites a link cannot blank out a token that is really
  // there in the fragment.
  const candidates = [cleanToken(fragment), cleanToken(remainder), cleanToken(queried)].filter(
    (token): token is string => token !== null,
  );
  if (candidates.length === 0) return null;
  // Two shapes naming two different tokens is not a link this app has ever
  // written, and picking a winner is what makes it dangerous: whichever one
  // loses is the one the person can see and believes they are accepting. Refuse
  // instead. It costs a genuine link nothing — a genuine link carries one.
  if (candidates.some((token) => token !== candidates[0])) return null;
  return candidates[0];
}
