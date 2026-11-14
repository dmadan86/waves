/**
 * Where this app is mounted. In production it lives under the marketing site's
 * origin at `/app` (see next.config.ts), so sign-in on the site is the app
 * session. `next/link` and the router add the prefix themselves; anything that
 * builds an absolute URL by hand — an OAuth redirect, an invite link — must go
 * through here.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** This origin plus the mount point plus `path` (which starts with `/`). */
export function appUrl(path: string): string {
  return `${window.location.origin}${BASE_PATH}${path}`;
}
