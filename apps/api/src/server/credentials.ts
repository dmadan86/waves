/**
 * The credentials this API issues, and how it recognises one again.
 *
 * A Waves API credential is a signed statement, not a random string looked up
 * in a table. It carries its own id and the id of the person it acts for, and
 * an HMAC over both; presenting one therefore proves possession of something
 * the server signed *before* any database work happens. That ordering is the
 * point of the design:
 *
 *   1. verify the HMAC — cheap, constant-time, and a forged token stops here;
 *   2. mint a 60-second `authenticated` JWT for the person the token names;
 *   3. ask the database, **as that person**, whether the token is still good.
 *
 * Step 3 is why this service needs no service-role key. A bug that let a caller
 * choose the token id could still only ever reach a row of their own, because
 * the session it asks under is theirs. And the row check is not redundant with
 * the signature: revocation, expiry, scope narrowing and the rate limit all
 * live in the row, and a signature cannot be un-signed.
 *
 * The database stores only `sha256(the whole token string)`. Nothing here can
 * recover a token from a row, which is what "shown once" has to mean.
 */

import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';

/** Which kind of credential a blob is, and the label its signature is bound to. */
export enum CredentialKind {
  /** A developer acting on their own account. */
  Personal = 'pat',
  /** An application acting for somebody who approved it. */
  Access = 'at',
  /** Exchanged for a new access token, once. */
  Refresh = 'rt',
  /** The five-minute middle of the OAuth dance. */
  Code = 'ac',
}

const PREFIX: Record<CredentialKind, string> = {
  [CredentialKind.Personal]: 'wavs_pat_',
  [CredentialKind.Access]: 'wavs_at_',
  [CredentialKind.Refresh]: 'wavs_rt_',
  [CredentialKind.Code]: 'wavs_ac_',
};

/**
 * Version 1 of the wire shape: one version byte, then two raw UUIDs, then a
 * 128-bit tag. Binary rather than JSON because a token is read by machines and
 * typed by humans, and 66 characters is a lot friendlier than 180.
 */
const VERSION = 1;
const BODY_BYTES = 1 + 16 + 16;
const TAG_BYTES = 16;

export interface Credential {
  readonly kind: CredentialKind;
  /** The row id in `api_tokens` (or `api_authorization_codes`). */
  readonly id: string;
  /** Whose rights this credential carries. */
  readonly profileId: string;
}

export interface MintedCredential extends Credential {
  /** The only time this string exists. Show it, then forget it. */
  readonly token: string;
  /** What the database stores, and what is compared on every call. */
  readonly hash: string;
  /** Enough of the token to recognise it in a list, and not enough to use it. */
  readonly prefix: string;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function uuidToBytes(value: string): Buffer {
  const hex = value.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) {
    throw new Error('not a uuid');
  }
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The tag is taken over the kind label as well as the body, so an access token
 * cannot be presented where a refresh token is expected. Without that domain
 * separation the two are the same 33 bytes under the same key, and "swap the
 * prefix" would be a valid attack.
 */
function tag(secret: string, kind: CredentialKind, body: Buffer): Buffer {
  return createHmac('sha256', secret).update(kind).update(body).digest().subarray(0, TAG_BYTES);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Base64url of the SHA-256 of a string — the shape PKCE calls S256. */
export function s256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function mintCredential(
  secret: string,
  kind: CredentialKind,
  profileId: string,
  id: string = randomUUID(),
): MintedCredential {
  const body = Buffer.concat([Buffer.from([VERSION]), uuidToBytes(id), uuidToBytes(profileId)]);
  const blob = base64url(Buffer.concat([body, tag(secret, kind, body)]));
  const token = `${PREFIX[kind]}${blob}`;
  return {
    kind,
    id,
    profileId,
    token,
    hash: sha256Hex(token),
    // Eight characters of a 128-bit-tagged blob identifies a token in a list
    // and is nowhere near enough to reconstruct one.
    prefix: `${PREFIX[kind]}${blob.slice(0, 8)}`,
  };
}

/**
 * Read a presented string back, or return null.
 *
 * Null for every failure, with no distinction between "wrong shape" and "wrong
 * signature": the difference is only useful to somebody probing, and the caller
 * above turns both into the same 401 anyway.
 */
export function verifyCredential(secret: string, presented: string): Credential | null {
  const kind = (Object.values(CredentialKind) as CredentialKind[]).find((candidate) =>
    presented.startsWith(PREFIX[candidate]),
  );
  if (!kind) return null;

  const blob = presented.slice(PREFIX[kind].length);
  if (!/^[A-Za-z0-9_-]+$/.test(blob)) return null;

  let raw: Buffer;
  try {
    raw = Buffer.from(blob, 'base64url');
  } catch {
    return null;
  }
  if (raw.length !== BODY_BYTES + TAG_BYTES) return null;

  const body = raw.subarray(0, BODY_BYTES);
  if (body[0] !== VERSION) return null;

  const presentedTag = raw.subarray(BODY_BYTES);
  const expected = tag(secret, kind, body);
  // Both are 16 bytes by construction, so timingSafeEqual cannot throw here —
  // and a plain `===` on the hex would leak the tag one character at a time.
  if (!timingSafeEqual(presentedTag, expected)) return null;

  return {
    kind,
    id: bytesToUuid(body.subarray(1, 17)),
    profileId: bytesToUuid(body.subarray(17, 33)),
  };
}

/**
 * A client secret: opaque, never parsed, only ever compared as a hash. Long
 * enough that the comparison is the only way to find it.
 */
export function mintClientSecret(): { secret: string; hash: string } {
  const secret = `wavs_cs_${base64url(Buffer.concat([uuidToBytes(randomUUID()), uuidToBytes(randomUUID())]))}`;
  return { secret, hash: sha256Hex(secret) };
}

/** A client id is public and only has to be unique and recognisable. */
export function mintClientId(): string {
  return `wavs_app_${randomUUID().replace(/-/g, '')}`;
}
