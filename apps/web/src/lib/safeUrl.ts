/**
 * A link somebody else typed, about to become an `href`.
 *
 * `receipt_share_url` (E3) is the one string in the ledger that a group member
 * writes and every other member's browser then renders as a link. Nothing on
 * the way in constrains its scheme — the phone stores what it is given, and
 * `javascript:` in an `href` is script execution on this origin the moment
 * somebody clicks it. On the phone that is harmless (there is no DOM, and
 * `Linking.openURL` refuses it); in a browser it is stored XSS.
 *
 * So the browser decides for itself what it is willing to link to: an absolute
 * `http:` or `https:` URL, nothing else. Not a filter on the value — a filter
 * on what gets rendered, which is the only boundary this app actually controls.
 * Relative and protocol-relative forms are rejected too: a share link is
 * somebody's cloud copy, so it is always absolute, and resolving one against
 * this origin would only ever be a mistake.
 */

/** The link itself if it is safe to render, otherwise null. */
export function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Not an absolute URL at all.
    return null;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
}
