/**
 * Reading a Firebase ID token, which is the whole of what stands between
 * "somebody proved they are holding that phone" and "somebody typed a phone
 * number into a box".
 *
 * Firebase sends the code and checks it; what comes back to us is a signed
 * assertion that it went well. Everything this app then does with that phone —
 * signing somebody in as the account that owns it, attaching it to the account
 * in hand — rests on this function and nothing else, so it is written to refuse
 * rather than to cope.
 *
 * Pure, and deliberately so. The keys are fetched by the caller (an edge
 * function, which can cache them) and the clock is injectable, which means every
 * rejection below is a unit test rather than a thing that has to be provoked
 * against Google's servers.
 *
 * The checks that are not obvious, and what each one stops:
 *
 *   * **The algorithm is pinned to RS256.** A token whose header says `none`, or
 *     says `HS256` so that the public key is used as an HMAC secret, is the
 *     oldest trick there is against a JWT verifier and it only works on a
 *     verifier that believes the header.
 *   * **The signature is checked before any claim is read.** Claims in an
 *     unverified token are attacker-supplied text.
 *   * **`sign_in_provider` must be `phone`.** Firebase will happily mint a token
 *     for a Google or email sign-in, and such a token can carry a
 *     `phone_number` claim. Without this check, signing into Firebase by any
 *     means would be a way to claim somebody else's number.
 *   * **`auth_time` must be recent.** An ID token is refreshable, so a token
 *     minted minutes ago can attest to a sign-in from last week. "They hold this
 *     phone" is a statement with a shelf life; a stale Firebase session sitting
 *     in someone's app is not proof of it today.
 */

/** One key from Google's published set, in JWK form. */
export interface FirebaseJwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
  readonly use?: string;
}

/** Who the token says is holding the phone. */
export interface FirebasePhoneIdentity {
  /** Firebase's own user id. Stable per project; not this app's identity. */
  readonly uid: string;
  /** E.164, as Firebase normalises it. */
  readonly phone: string;
  /** When the code was actually entered, in seconds since the epoch. */
  readonly signedInAt: number;
}

/**
 * Why a token was refused. Returned rather than thrown so the caller decides
 * what the person sees — and so the reason can be logged without any of these
 * ever reaching them, since "wrong audience" tells an attacker which knob to
 * turn next.
 */
export type FirebaseTokenRejection =
  | 'malformed'
  | 'algorithm'
  | 'unknown-key'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'not-yet-valid'
  | 'stale-sign-in'
  | 'not-a-phone-sign-in'
  | 'no-subject'
  | 'no-phone';

export type FirebaseTokenResult =
  | { readonly ok: true; readonly identity: FirebasePhoneIdentity }
  | { readonly ok: false; readonly reason: FirebaseTokenRejection };

export interface FirebaseTokenCheck {
  /** The compact JWT, exactly as the client sent it. */
  readonly token: string;
  /** Google's current signing keys, fetched and cached by the caller. */
  readonly keys: readonly FirebaseJwk[];
  /** The Firebase project id. Both the audience and the tail of the issuer. */
  readonly projectId: string;
  /** Seconds since the epoch. Injectable so every clock case is a unit test. */
  readonly now?: number;
  /** Allowance for the two machines disagreeing about the time. */
  readonly clockSkewSeconds?: number;
  /** How long after entering the code the assertion still counts. */
  readonly maxSignInAgeSeconds?: number;
}

export const FIREBASE_CLOCK_SKEW_SECONDS = 60;

/**
 * Ten minutes: long enough for somebody to read an SMS, mistype it twice, and
 * still get in on a slow connection; far too short for a Firebase session found
 * on a phone weeks later to be worth anything.
 */
export const FIREBASE_MAX_SIGN_IN_AGE_SECONDS = 10 * 60;

/** The JSON Google publishes its keys as, with anything else ignored. */
export interface FirebaseJwkSet {
  readonly keys?: readonly FirebaseJwk[];
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

interface JwtClaims {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  auth_time?: unknown;
  phone_number?: unknown;
  firebase?: { sign_in_provider?: unknown } | unknown;
}

function base64UrlToBytes(value: string): Uint8Array | null {
  // A JWT segment is base64url and unpadded. Anything outside that alphabet is
  // not a segment somebody mistyped, it is a segment somebody built.
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  try {
    const binary = atob(full);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJson<T>(segment: string): T | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/**
 * The bytes as a plain `ArrayBuffer`.
 *
 * `Uint8Array` is typed over `ArrayBufferLike`, which could be a
 * `SharedArrayBuffer`, and WebCrypto will not take one — the same reason
 * `base64ToBuffer` exists beside the webhook verifier.
 */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The most a token may be before it is refused unread.
 *
 * Firebase's own are around 800 bytes. This is not a security boundary — the
 * signature is — but a verifier that will base64-decode and JSON-parse whatever
 * arrives is a way to spend an isolate's memory without a valid credential.
 */
const MAX_TOKEN_BYTES = 8 * 1024;

export async function verifyFirebaseIdToken(
  check: FirebaseTokenCheck,
): Promise<FirebaseTokenResult> {
  const reject = (reason: FirebaseTokenRejection): FirebaseTokenResult => ({ ok: false, reason });

  if (typeof check.token !== 'string' || check.token.length > MAX_TOKEN_BYTES) {
    return reject('malformed');
  }
  const parts = check.token.split('.');
  if (parts.length !== 3) return reject('malformed');
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];

  const header = decodeJson<JwtHeader>(encodedHeader);
  if (!header) return reject('malformed');

  // Pinned, never read as a preference. See the note at the top of the file.
  if (header.alg !== 'RS256') return reject('algorithm');
  if (typeof header.kid !== 'string' || header.kid === '') return reject('unknown-key');

  const jwk = check.keys.find((key) => key.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') return reject('unknown-key');

  const signature = base64UrlToBytes(encodedSignature);
  if (!signature) return reject('malformed');

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      toBuffer(signature),
      toBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)),
    );
  } catch {
    // A key that will not import is a key we cannot verify against, and the safe
    // reading of a check that could not run is that nothing was proved.
    return reject('signature');
  }
  if (!verified) return reject('signature');

  // Only now is any of this worth reading.
  const claims = decodeJson<JwtClaims>(encodedClaims);
  if (!claims) return reject('malformed');

  const now = check.now ?? Math.floor(Date.now() / 1000);
  const skew = check.clockSkewSeconds ?? FIREBASE_CLOCK_SKEW_SECONDS;
  const maxAge = check.maxSignInAgeSeconds ?? FIREBASE_MAX_SIGN_IN_AGE_SECONDS;

  if (claims.iss !== `https://securetoken.google.com/${check.projectId}`) return reject('issuer');
  if (claims.aud !== check.projectId) return reject('audience');

  if (!isPositiveInteger(claims.exp) || claims.exp + skew <= now) return reject('expired');
  if (!isPositiveInteger(claims.iat) || claims.iat - skew > now) return reject('not-yet-valid');

  const provider =
    typeof claims.firebase === 'object' && claims.firebase !== null
      ? (claims.firebase as { sign_in_provider?: unknown }).sign_in_provider
      : undefined;
  if (provider !== 'phone') return reject('not-a-phone-sign-in');

  if (!isPositiveInteger(claims.auth_time)) return reject('stale-sign-in');
  if (claims.auth_time - skew > now) return reject('not-yet-valid');
  if (now - claims.auth_time > maxAge) return reject('stale-sign-in');

  if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 128) {
    return reject('no-subject');
  }

  // E.164 or nothing. Firebase normalises what it sends, and a number that does
  // not look like one has no business being matched against an account.
  if (typeof claims.phone_number !== 'string' || !/^\+[1-9]\d{6,14}$/.test(claims.phone_number)) {
    return reject('no-phone');
  }

  return {
    ok: true,
    identity: { uid: claims.sub, phone: claims.phone_number, signedInAt: claims.auth_time },
  };
}
