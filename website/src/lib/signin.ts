/** Where each sign-in choice lands in the web app. The app runs the sign-in itself (see apps/web/src/lib/signInIntent.ts). */
export function signInHref(appUrl: string, which: 'google' | 'apple'): string {
  const url = new URL('/', appUrl);
  url.searchParams.set('signin', which);
  return url.toString();
}

/** The host named in the hand-off sentence, so it follows NEXT_PUBLIC_APP_URL. */
export function appHost(appUrl: string): string {
  return new URL(appUrl).host;
}
