/**
 * AdMob signature verification with a generated test key pair: a callback signed
 * the way Google signs one verifies; any change to the message, the signature,
 * the key id or the key does not.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  base64ToBytes,
  derToP1363,
  parseKeys,
  splitSignedQuery,
  VerifierKeys,
  verifyCallback,
  VERIFIER_KEYS_URL,
} from './verify.ts';

function toBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const std = btoa(binary);
  return urlSafe ? std.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : std;
}

/** raw r||s (what Web Crypto produces) to the DER AdMob sends. */
function p1363ToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array): number[] => {
    let b = Array.from(bytes);
    while (b.length > 1 && b[0] === 0) b = b.slice(1);
    if ((b[0] ?? 0) >= 0x80) b = [0, ...b];
    return [0x02, b.length, ...b];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

async function makeKey(keyId = '3335741209') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { pair, keyId, base64: toBase64(spki) };
}

async function sign(privateKey: CryptoKey, message: string): Promise<string> {
  const raw = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new TextEncoder().encode(message),
    ),
  );
  return toBase64(p1363ToDer(raw), true);
}

const MESSAGE =
  'ad_network=5450213213286189855&ad_unit=1234567890&custom_data=voice&reward_amount=1&reward_item=Reward&timestamp=1790000000000&transaction_id=ABCDEF0123456789&user_id=6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';

async function signedQuery(key: Awaited<ReturnType<typeof makeKey>>, message = MESSAGE) {
  return `${message}&signature=${await sign(key.pair.privateKey, message)}&key_id=${key.keyId}`;
}

function keyList(...keys: { keyId: string; base64: string }[]) {
  return { keys: keys.map((k) => ({ keyId: Number(k.keyId), pem: '', base64: k.base64 })) };
}

function fetchOf(body: unknown, ok = true) {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('derToP1363', () => {
  it('round-trips a signature, including short integers that need left padding', () => {
    const raw = new Uint8Array(64);
    raw[31] = 1; // r = 1: DER writes one byte, P1363 needs 32
    raw.fill(0xff, 32); // s with the high bit set: DER prepends 0x00
    const back = derToP1363(p1363ToDer(raw));
    expect(Array.from(back)).toEqual(Array.from(raw));
  });

  it('rejects things that are not a DER signature', () => {
    expect(() => derToP1363(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => derToP1363(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]))).toThrow();
    expect(() => derToP1363(new Uint8Array())).toThrow();
  });
});

describe('splitSignedQuery', () => {
  it('splits the signed message from the signature and key id', () => {
    expect(splitSignedQuery(`${MESSAGE}&signature=abc_-&key_id=42`)).toEqual({
      message: MESSAGE,
      signature: 'abc_-',
      keyId: '42',
    });
  });

  it('is null for an unsigned query or one missing the key id', () => {
    expect(splitSignedQuery(MESSAGE)).toBeNull();
    expect(splitSignedQuery(`${MESSAGE}&signature=abc`)).toBeNull();
    expect(splitSignedQuery('signature=abc&key_id=1')).toBeNull();
    expect(splitSignedQuery('')).toBeNull();
  });
});

describe('parseKeys', () => {
  it('reads base64 or pem and drops malformed entries', () => {
    expect(
      parseKeys({
        keys: [
          { keyId: 1, base64: 'AAAA' },
          { keyId: 2, pem: '-----BEGIN PUBLIC KEY-----\nBBBB\nCCCC\n-----END PUBLIC KEY-----' },
          { keyId: 3 },
          { base64: 'DDDD' },
        ],
      }),
    ).toEqual([
      { keyId: '1', base64: 'AAAA' },
      { keyId: '2', base64: 'BBBBCCCC' },
    ]);
    expect(parseKeys(null)).toEqual([]);
    expect(parseKeys({ keys: 'no' })).toEqual([]);
  });
});

describe('verifyCallback', () => {
  it('accepts a callback signed by the published key', async () => {
    const key = await makeKey();
    const keys = new VerifierKeys(fetchOf(keyList(key)));
    expect(await verifyCallback(await signedQuery(key), keys)).toBe(true);
  });

  it('decodes URL-encoded characters before verifying the message', async () => {
    const key = await makeKey();
    const keys = new VerifierKeys(fetchOf(keyList(key)));
    const good = await signedQuery(
      key,
      MESSAGE.replace('custom_data=voice', 'custom_data=credit:voice'),
    );
    expect(await verifyCallback(good.replace('credit:voice', 'credit%3Avoice'), keys)).toBe(true);
  });

  it('rejects a changed message (a swapped user, kind or transaction)', async () => {
    const key = await makeKey();
    const keys = new VerifierKeys(fetchOf(keyList(key)));
    const good = await signedQuery(key);
    expect(await verifyCallback(good.replace('user_id=6f1c', 'user_id=7f1c'), keys)).toBe(false);
    expect(await verifyCallback(good.replace('custom_data=voice', 'custom_data=scan'), keys)).toBe(
      false,
    );
    expect(await verifyCallback(good.replace('ABCDEF', 'ABCDEE'), keys)).toBe(false);
    expect(await verifyCallback(`extra=1&${good}`, keys)).toBe(false);
  });

  it('rejects a signature from a different key pair', async () => {
    const published = await makeKey();
    const forger = await makeKey(published.keyId);
    const keys = new VerifierKeys(fetchOf(keyList(published)));
    expect(await verifyCallback(await signedQuery(forger), keys)).toBe(false);
  });

  it('rejects garbage signatures and unsigned queries without throwing', async () => {
    const key = await makeKey();
    const keys = new VerifierKeys(fetchOf(keyList(key)));
    expect(await verifyCallback(`${MESSAGE}&signature=!!!&key_id=${key.keyId}`, keys)).toBe(false);
    expect(await verifyCallback(`${MESSAGE}&signature=AAAA&key_id=${key.keyId}`, keys)).toBe(false);
    expect(await verifyCallback(MESSAGE, keys)).toBe(false);
  });

  it('rejects an unknown key id', async () => {
    const key = await makeKey('111');
    const other = await makeKey('222');
    const keys = new VerifierKeys(fetchOf(keyList(key)));
    expect(await verifyCallback(await signedQuery(other), keys)).toBe(false);
  });
});

describe('VerifierKeys', () => {
  it('fetches once and caches the list', async () => {
    const key = await makeKey();
    const fetchFn = fetchOf(keyList(key));
    const keys = new VerifierKeys(fetchFn);
    await keys.get(key.keyId);
    await keys.get(key.keyId);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(VERIFIER_KEYS_URL);
  });

  it('re-reads after the TTL', async () => {
    const key = await makeKey();
    let now = 0;
    const fetchFn = fetchOf(keyList(key));
    const keys = new VerifierKeys(fetchFn, () => now);
    await keys.get(key.keyId);
    now += 7 * 60 * 60 * 1000;
    await keys.get(key.keyId);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('picks up a rotated key, but re-reads for unknown ids at most once per cooldown', async () => {
    const old = await makeKey('1');
    const fresh = await makeKey('2');
    let now = 1_000_000_000;
    let list = keyList(old);
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(list)),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const keys = new VerifierKeys(fetchFn, () => now);
    await keys.get('1');
    list = keyList(old, fresh);
    now += 6 * 60 * 1000;
    expect(await keys.get('2')).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    now += 1000;
    expect(await keys.get('999')).toBeNull();
    expect(await keys.get('998')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws when the list cannot be read, so the caller can answer 5xx', async () => {
    await expect(new VerifierKeys(fetchOf({}, false)).get('1')).rejects.toThrow();
    await expect(new VerifierKeys(fetchOf({ keys: [] })).get('1')).rejects.toThrow();
  });
});

describe('base64ToBytes', () => {
  it('reads standard and url-safe base64, padded or not', () => {
    expect(Array.from(base64ToBytes('+/8='))).toEqual([0xfb, 0xff]);
    expect(Array.from(base64ToBytes('-_8'))).toEqual([0xfb, 0xff]);
  });
});
