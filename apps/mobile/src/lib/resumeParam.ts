/**
 * Remove the `resume` query parameter from any incoming link.
 *
 * `resume=1` is only ever set by in-app router calls
 * (`PendingInviteResume.tsx` → `router.replace(resumeRoute(token))`), which
 * never pass through `redirectSystemPath`. Stripping it here prevents an
 * externally crafted link from triggering the auto-join path on `join.tsx`.
 *
 * Handles:
 *   - sole query param:    `/join?resume=1`        → `/join`
 *   - first param:         `/join?resume=1&token=X`→ `/join?token=X`
 *   - middle/last param:   `?token=X&resume=1`     → `?token=X`
 *   - fragment preserved:  `?resume=1#frag`        → `#frag`
 *   - no `resume` param:   unchanged
 */
export function stripResumeParam(path: string): string {
  // Split fragment off first so we never corrupt it.
  const hashIndex = path.indexOf('#');
  const base = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : path.slice(hashIndex);

  const qIndex = base.indexOf('?');
  if (qIndex === -1) return path; // no query string — nothing to strip

  const beforeQuery = base.slice(0, qIndex);
  const queryString = base.slice(qIndex + 1);

  // Filter out all occurrences of the `resume` key (any value).
  // Keys are compared after percent-decoding ('+' → space) so that an
  // externally crafted link cannot sneak `resume` past the guard as `%72esume`
  // or any other encoded variant.  A part whose key fails to decode is
  // malformed and is dropped rather than passed through.
  const kept = queryString.split('&').filter((part) => {
    const eqIdx = part.indexOf('=');
    const rawKey = eqIdx === -1 ? part : part.slice(0, eqIdx);
    // Replace '+' with space before decoding, mirroring application/x-www-form-urlencoded.
    try {
      const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      return key.toLowerCase() !== 'resume';
    } catch {
      // Malformed percent-encoding — drop the part entirely.
      return false;
    }
  });

  const newQuery = kept.length > 0 ? `?${kept.join('&')}` : '';
  return beforeQuery + newQuery + fragment;
}
