/**
 * A marker the website (wavs.co.in) reads to show "Dashboard" instead of
 * "Sign in". It holds no token or id: the session itself stays in this
 * origin's storage. Shared with the parent domain only on wavs.co.in hosts.
 */
export const SIGNED_IN_COOKIE = 'waves_signed_in';

export function signedInCookie(signedIn: boolean, host: string): string {
  const domain = host === 'wavs.co.in' || host.endsWith('.wavs.co.in') ? '; Domain=wavs.co.in' : '';
  const value = signedIn ? '1; Max-Age=2592000' : '; Max-Age=0';
  return `${SIGNED_IN_COOKIE}=${value}; Path=/; SameSite=Lax; Secure${domain}`;
}

export function markSignedIn(signedIn: boolean): void {
  document.cookie = signedInCookie(signedIn, window.location.hostname);
}
