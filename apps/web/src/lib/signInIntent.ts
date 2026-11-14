/**
 * What the marketing site's sign-in page asks the door to do: `/?signin=google`,
 * `/?signin=apple`, or `/?signin=email&email=a@b.co` (prefill only).
 *
 * The sign-in itself always runs here, on this origin, so PKCE's verifier stays
 * in this browser and no token ever crosses origins. The link is therefore only
 * a hint: it starts the person's own provider sign-in or fills a field, and an
 * attacker's link can do nothing worse than that. It never sends a code mail or
 * touches a password — a link must not be able to mail a stranger.
 */
export type SignInIntent =
  | { kind: 'google' }
  | { kind: 'apple' }
  | { kind: 'email'; email: string }
  | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readSignInIntent(search: string): SignInIntent {
  const params = new URLSearchParams(search);
  const which = params.get('signin');
  if (which === 'google' || which === 'apple') return { kind: which };
  if (which === 'email') {
    const email = (params.get('email') ?? '').trim();
    return { kind: 'email', email: email.length <= 254 && EMAIL.test(email) ? email : '' };
  }
  return null;
}
