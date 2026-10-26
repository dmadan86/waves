/**
 * Google AdMob server-side verification (SSV): checking that a reward callback
 * really came from Google.
 *
 * AdMob calls our URL with a GET whose query string ends in
 * `&signature=<base64url DER ECDSA>&key_id=<id>`. The signed message is the query
 * string URL-decoded, up to (not including) `&signature=`. The signature is
 * ECDSA P-256 over SHA-256, checked against the public key whose id is `key_id`
 * in Google's published list:
 * https://www.gstatic.com/admob/reward/verifier-keys.json
 *
 * Web Crypto wants the raw `r || s` form (IEEE P1363), not DER, so the signature
 * is converted. Nothing here touches the database.
 */

export const VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

/** How long the key list is trusted before it is read again. */
export const KEYS_TTL_MS = 6 * 60 * 60 * 1000;
/** An unknown key id may mean Google rotated keys; re-read at most this often. */
export const KEYS_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export interface VerifierKey {
  readonly keyId: string;
  /** Base64 (standard) of the SubjectPublicKeyInfo DER. */
  readonly base64: string;
}

/** Standard or URL-safe base64, padded or not, to bytes. */
export function base64ToBytes(input: string): Uint8Array {
  const std = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** DER `SEQUENCE { INTEGER r, INTEGER s }` to the 64-byte `r || s` Web Crypto expects. */
export function derToP1363(der: Uint8Array, size = 32): Uint8Array {
  let at = 0;
  const readLength = (): number => {
    const first = der[at++];
    if (first === undefined) throw new Error('bad DER');
    if (first < 0x80) return first;
    const count = first & 0x7f;
    if (count < 1 || count > 2) throw new Error('bad DER length');
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = der[at++];
      if (byte === undefined) throw new Error('bad DER');
      value = (value << 8) | byte;
    }
    return value;
  };
  if (der[at++] !== 0x30) throw new Error('bad DER: no sequence');
  const total = readLength();
  if (at + total !== der.length) throw new Error('bad DER: length');
  const readInt = (): Uint8Array => {
    if (der[at++] !== 0x02) throw new Error('bad DER: no integer');
    const length = readLength();
    let bytes = der.slice(at, at + length);
    if (bytes.length !== length) throw new Error('bad DER: short');
    at += length;
    while (bytes.length > 0 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length > size) throw new Error('bad DER: integer too large');
    const out = new Uint8Array(size);
    out.set(bytes, size - bytes.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  if (at !== der.length) throw new Error('bad DER: trailing bytes');
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

export interface SsvParts {
  /** The signed message: the decoded query string before `&signature=`. */
  readonly message: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly signature: string;
  readonly keyId: string;
}

/**
 * Splits the RAW query string (as received, not re-encoded) into the signed
 * message, the signature and the key id. Null when it is not a signed callback.
 */
export function splitSignedQuery(rawQuery: string): SsvParts | null {
  const query = rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
  const marker = query.indexOf('&signature=');
  if (marker <= 0) return null;
  let message: string;
  try {
    message = decodeURIComponent(query.slice(0, marker));
  } catch {
    return null;
  }
  const fields = new Map<string, string>();
  for (const pair of message.split('&')) {
    const separator = pair.indexOf('=');
    if (separator < 0) return null;
    const key = pair.slice(0, separator);
    if (fields.has(key)) return null;
    fields.set(key, pair.slice(separator + 1));
  }
  const rest = new URLSearchParams(query.slice(marker + 1));
  const signature = rest.get('signature');
  const keyId = rest.get('key_id');
  if (!signature || !keyId) return null;
  return { message, fields, signature, keyId };
}

export async function importKey(key: VerifierKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    base64ToBytes(key.base64) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

/** True when `signature` is a valid ECDSA/SHA-256 signature of `message` by `key`. */
export async function verifySignature(
  key: VerifierKey,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const publicKey = await importKey(key);
    const raw = derToP1363(base64ToBytes(signature));
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      raw as BufferSource,
      new TextEncoder().encode(message) as BufferSource,
    );
  } catch {
    return false;
  }
}

/** Parses Google's key list; anything malformed is dropped. */
export function parseKeys(body: unknown): VerifierKey[] {
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return [];
  const out: VerifierKey[] = [];
  for (const entry of keys) {
    const e = entry as { keyId?: unknown; base64?: unknown; pem?: unknown };
    const keyId = typeof e.keyId === 'number' || typeof e.keyId === 'string' ? String(e.keyId) : '';
    let base64 = typeof e.base64 === 'string' ? e.base64 : '';
    if (!base64 && typeof e.pem === 'string') {
      base64 = e.pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    }
    if (keyId && base64) out.push({ keyId, base64 });
  }
  return out;
}

/** Google's verifier keys, cached per warm instance. */
export class VerifierKeys {
  private keys: VerifierKey[] = [];
  private loadedAt = 0;
  private triedAt = 0;

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async load(): Promise<void> {
    this.triedAt = this.now();
    const response = await this.fetchFn(VERIFIER_KEYS_URL);
    if (!response.ok) throw new Error(`verifier keys ${response.status}`);
    const keys = parseKeys(await response.json());
    if (keys.length === 0) throw new Error('verifier keys empty');
    this.keys = keys;
    this.loadedAt = this.now();
  }

  /** The key with this id, or null if Google does not publish one. Throws if the list cannot be read. */
  async get(keyId: string): Promise<VerifierKey | null> {
    const at = this.now();
    if (this.keys.length === 0 || at - this.loadedAt > KEYS_TTL_MS) {
      await this.load();
    }
    const hit = this.keys.find((k) => k.keyId === keyId);
    if (hit) return hit;
    // Unknown id: maybe rotated. One re-read per cooldown, so a flood of bad ids costs nothing.
    if (at - this.triedAt > KEYS_REFRESH_COOLDOWN_MS) {
      await this.load();
      return this.keys.find((k) => k.keyId === keyId) ?? null;
    }
    return null;
  }
}

/** Returns the signed fields when the callback verifies against Google's keys. */
export async function verifyCallback(
  rawQuery: string,
  keys: VerifierKeys,
): Promise<ReadonlyMap<string, string> | null> {
  const parts = splitSignedQuery(rawQuery);
  if (!parts) return null;
  const key = await keys.get(parts.keyId);
  if (!key) return null;
  return (await verifySignature(key, parts.message, parts.signature)) ? parts.fields : null;
}
