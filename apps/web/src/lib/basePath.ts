/**
 * Where this app is mounted. In production it lives under the marketing site's
 * origin at `/app` (see next.config.ts), so sign-in on the site is the app
 * session. `next/link` and the router add the prefix themselves; anything that
 * builds an absolute URL by hand — an OAuth redirect, an invite link — must go
 * through here.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Set when mounted under the site: invites use the old app host, which the phone app opens. */
const INVITE_ORIGIN = process.env.NEXT_PUBLIC_INVITE_ORIGIN ?? '';

/** The join link for a group invite token. */
export function inviteUrl(token: string): string {
  return INVITE_ORIGIN ? `${INVITE_ORIGIN}/join#${token}` : `${appUrl('/join')}#${token}`;
}

/** This origin plus the mount point plus `path` (which starts with `/`). */
export function appUrl(path: string): string {
  return `${window.location.origin}${BASE_PATH}${path}`;
}
