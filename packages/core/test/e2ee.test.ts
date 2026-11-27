import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { describe, expect, it } from 'vitest';
import { e2ee } from '../src/index';
import {
  applyOps,
  chunkSnapshot,
  compareHlc,
  generateDeviceKeyPair,
  materialise,
  materialiseAll,
  MAX_MESSAGE_BYTES,
  open,
  pairKey,
  reassemble,
  receive,
  seal,
  sharedSecret,
  tick,
  type EnvelopeAad,
  type MergeOp,
  type PutOp,
  type RecordState,
  type Store,
} from '../src/e2ee/index';

const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const seq = (seed: number) => (n: number) =>
  Uint8Array.from({ length: n }, (_, i) => (seed * 31 + i * 7) & 255);

describe('keys', () => {
  it('RFC 7748 5.2 scalar multiplication vector', () => {
    const out = x25519.scalarMult(
      hex('a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4'),
      hex('e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c'),
    );
    expect(toHex(out)).toBe('c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552');
  });

  const alice = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bob = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  it('RFC 7748 6.1 Alice and Bob', () => {
    const pa = generateDeviceKeyPair(() => alice).publicKey;
    const pb = generateDeviceKeyPair(() => bob).publicKey;
    expect(toHex(pa)).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(toHex(pb)).toBe('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
    const k = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    expect(toHex(sharedSecret(alice, pb))).toBe(k);
    expect(toHex(sharedSecret(bob, pa))).toBe(k);
  });

  it('pairKey is symmetric, 32 bytes, and differs per pair', () => {
    const a = generateDeviceKeyPair(seq(1));
    const b = generateDeviceKeyPair(seq(2));
    const c = generateDeviceKeyPair(seq(3));
    expect(pairKey(a.privateKey, b.publicKey)).toEqual(pairKey(b.privateKey, a.publicKey));
    expect(pairKey(a.privateKey, b.publicKey)).toHaveLength(32);
    expect(pairKey(a.privateKey, b.publicKey)).not.toEqual(pairKey(a.privateKey, c.publicKey));
  });

  it('rejects an all-zero (low-order) peer key', () => {
    const a = generateDeviceKeyPair(seq(1));
    expect(() => pairKey(a.privateKey, new Uint8Array(32))).toThrow();
  });
});

describe('envelope', () => {
  const key = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const nonce = Uint8Array.from({ length: 24 }, (_, i) => i + 100);
  const aad: EnvelopeAad = {
    groupId: 'g1',
    senderDevice: 'dA',
    recipientDevice: 'dB',
    msgId: 'm1',
  };
  const pt = { v: 1 as const, msgId: 'm1', ops: [{ op: 'del', id: 'x', hlc: '1:0:dA' }] };

  it('fixed-nonce known answer', () => {
    const sealed = seal(key, pt, aad, nonce);
    expect(sealed.subarray(0, 24)).toEqual(nonce);
    const ref = xchacha20poly1305(key, nonce, new TextEncoder().encode('g1|dA|dB|m1')).encrypt(
      new TextEncoder().encode(JSON.stringify(pt)),
    );
    expect(toHex(sealed.subarray(24))).toBe(toHex(ref));
    expect(toHex(sealed)).toBe(KAT);
    expect(open(key, sealed, aad)).toEqual(pt);
  });

  it('fresh random nonce each seal', () => {
    expect(seal(key, pt, aad).subarray(0, 24)).not.toEqual(seal(key, pt, aad).subarray(0, 24));
  });

  it('throws on tampered ciphertext, nonce, tag or any AAD field', () => {
    const sealed = seal(key, pt, aad, nonce);
    for (const i of [0, 23, 24, sealed.length - 1]) {
      const bad = sealed.slice();
      bad[i]! ^= 1;
      expect(() => open(key, bad, aad)).toThrow();
    }
    for (const f of Object.keys(aad) as (keyof EnvelopeAad)[]) {
      expect(() => open(key, sealed, { ...aad, [f]: aad[f] + 'x' })).toThrow();
    }
    expect(() => open(new Uint8Array(32), sealed, aad)).toThrow();
    expect(() => open(key, sealed.subarray(0, 10), aad)).toThrow();
  });

  it('round-trips bigints, nested', () => {
    const p = {
      v: 1 as const,
      msgId: 'm',
      ops: [{ amount: 12345678901234567890123n, list: [-5n, 0n], s: 'ok' }],
    };
    expect(open(key, seal(key, p, aad), aad)).toEqual(p);
  });
});

describe('hlc', () => {
  it('orders by wall, then counter, then device', () => {
    expect(compareHlc('1:0:a', '2:0:a')).toBeLessThan(0);
    expect(compareHlc('2:0:a', '2:1:a')).toBeLessThan(0);
    expect(compareHlc('2:1:a', '2:1:b')).toBeLessThan(0);
    expect(compareHlc('2:1:b', '2:1:b')).toBe(0);
    expect(compareHlc('10:0:a', '9:0:a')).toBeGreaterThan(0);
  });
  it('tick advances even when the wall clock stalls or goes back', () => {
    const a = tick(null, 100, 'd');
    const b = tick(a, 100, 'd');
    const c = tick(b, 50, 'd');
    expect(a).toBe('100:0:d');
    expect([compareHlc(a, b), compareHlc(b, c)].every((x) => x < 0)).toBe(true);
    expect(tick(c, 200, 'd')).toBe('200:0:d');
  });
  it('receive is later than both local and remote', () => {
    expect(receive('100:3:a', '100:5:b', 100, 'a')).toBe('100:6:a');
    expect(receive('100:3:a', '300:1:b', 100, 'a')).toBe('300:2:a');
    expect(receive('400:2:a', '300:9:b', 100, 'a')).toBe('400:3:a');
    expect(receive(null, '50:0:b', 10, 'a')).toBe('50:1:a');
    expect(receive('1:0:a', '2:0:b', 900, 'a')).toBe('900:0:a');
  });
  it('is exported under the e2ee namespace', () => {
    expect(e2ee.tick).toBe(tick);
  });
});

const put = (id: string, by: string, fields: Record<string, [unknown, string]>): PutOp => ({
  op: 'put',
  id,
  kind: 'rent',
  createdBy: by,
  fields,
});
const del = (id: string, hlc: string): MergeOp => ({ op: 'del', id, hlc });
const run = (ops: MergeOp[], sender = 'A'): Store => applyOps({}, ops, sender, { trusted: true });

const permutations = <T>(xs: T[]): T[][] =>
  xs.length <= 1
    ? [xs]
    : xs.flatMap((x, i) =>
        permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
      );

describe('merge', () => {
  const ops: MergeOp[] = [
    put('r1', 'A', { rent: [100n, '1:0:A'], note: ['hi', '1:0:A'] }),
    put('r1', 'A', { rent: [120n, '3:0:B'] }),
    put('r1', 'A', { note: ['yo', '2:0:B'] }),
    del('r1', '2:5:A'),
    put('r2', 'B', { rent: [7n, '1:0:B'] }),
  ];

  it('is order independent (all permutations)', () => {
    const want = JSON.stringify(materialiseAll(run(ops)), (_k, v) =>
      typeof v === 'bigint' ? `${v}n` : v,
    );
    for (const p of permutations(ops)) {
      expect(
        JSON.stringify(materialiseAll(run(p)), (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)),
      ).toBe(want);
      expect(run(p)).toEqual(run(ops));
    }
  });

  it('is idempotent and associative across batches', () => {
    const once = run(ops);
    expect(applyOps(once, ops, 'A', { trusted: true })).toEqual(once);
    const split = applyOps(run(ops.slice(0, 2)), ops.slice(2), 'A', { trusted: true });
    expect(split).toEqual(once);
  });

  it('per-field last write wins', () => {
    const s = run([
      put('r', 'A', { x: [1, '1:0:A'], y: [1, '1:0:A'] }),
      put('r', 'A', { x: [2, '2:0:B'], y: [0, '0:0:B'] }),
    ]);
    expect(materialise(s.r!)).toMatchObject({ x: 2, y: 1 });
  });

  it('delete hides older fields; a later put revives only newer fields', () => {
    const s = run([put('r', 'A', { a: [1, '1:0:A'], b: [1, '1:0:A'] }), del('r', '5:0:A')]);
    expect(materialise(s.r!)).toBeNull();
    expect(materialiseAll(s)).toEqual([]);
    const s2 = applyOps(s, [put('r', 'A', { b: [9, '7:0:B'], a: [8, '4:0:B'] })], 'A');
    expect(materialise(s2.r!)).toEqual({ b: 9, id: 'r', kind: 'rent', createdBy: 'A' });
  });

  it('a delete arriving before its put still tombstones', () => {
    const s = applyOps(
      applyOps({}, [del('r', '5:0:A')], 'B'),
      [put('r', 'A', { a: [1, '1:0:A'] })],
      'A',
    );
    expect(materialise(s.r!)).toBeNull();
    expect(s.r!.createdBy).toBe('A');
  });

  it('createdBy must match the sender on first sight', () => {
    expect(applyOps({}, [put('r', 'B', { a: [1, '1:0:B'] })], 'A')).toEqual({});
    expect(applyOps({}, [put('r', 'B', { a: [1, '1:0:B'] })], 'B').r).toBeDefined();
  });

  it('createdBy and kind are fixed once seen', () => {
    const s = applyOps({}, [put('r', 'A', { a: [1, '1:0:A'] })], 'A');
    // A competing creation by B merges its fields but the earlier author (A) keeps the record.
    const s2 = applyOps(s, [put('r', 'B', { a: [2, '9:0:B'] })], 'B');
    expect(materialise(s2.r!)).toMatchObject({ a: 2, createdBy: 'A' });
    // Nobody may put under someone else's name.
    expect(applyOps(s, [put('r', 'C', { a: [5, '9:0:B'] })], 'B')).toEqual(s);
    expect(applyOps(s, [{ ...put('r', 'A', { a: [2, '9:0:A'] }), kind: 'other' }], 'A')).toEqual(s);
    // The creator's partner may edit once the record is known.
    const s3 = applyOps(s, [put('r', 'A', { a: [3, '9:0:B'] })], 'B');
    expect(materialise(s3.r!)).toMatchObject({ a: 3, createdBy: 'A' });
  });
});

describe('double creation of one id', () => {
  const a = put('r', 'A', { amt: [100n, '5:0:A'], note: ['a', '5:0:A'] });
  const b = put('r', 'B', { amt: [90n, '3:0:B'], note: ['b', '3:0:B'] });
  const apply = (order: [MergeOp, MergeOp]) =>
    order.reduce<Store>((s, op) => applyOps(s, [op], (op as PutOp).createdBy), {});

  it('settles on the earliest author in either order, with merged fields', () => {
    const x = apply([a, b]);
    const y = apply([b, a]);
    expect(x).toEqual(y);
    expect(materialise(x.r!)).toEqual({ amt: 100n, note: 'a', id: 'r', kind: 'rent', createdBy: 'B' });
  });

  it('ties on the hlc go to the smaller author id, in either order', () => {
    const a2 = put('r', 'A', { n: [1, '3:0:Z'] });
    const b2 = put('r', 'B', { n: [1, '3:0:Z'] });
    expect(apply([a2, b2])).toEqual(apply([b2, a2]));
    expect(apply([a2, b2]).r!.createdBy).toBe('A');
  });

  it('is order independent with an edit by the other partner in the mix', () => {
    const edit = put('r', 'B', { note: ['late', '9:0:A'] });
    const all = [a, b, edit];
    const want = run(all, 'B');
    for (const p of permutations(all)) expect(run(p, 'B')).toEqual(want);
  });
});

describe('chunk', () => {
  const rec = (i: number, size: number): RecordState => ({
    id: `rec-${i}`,
    kind: 'rent',
    createdBy: 'A',
    fields: {
      note: ['é'.repeat(size) + i, `${i}:0:A`],
      amount: [BigInt(i) * 10n ** 15n, `${i}:0:A`],
    },
  });
  const key = new Uint8Array(32).fill(7);
  const aad: EnvelopeAad = { groupId: 'g', senderDevice: 'a', recipientDevice: 'b', msgId: 'm-1' };

  it('keeps every sealed part under 64 KiB and reassembles shuffled, duplicated parts', () => {
    const records = Array.from({ length: 120 }, (_, i) => rec(i, 500 + (i % 7) * 300));
    const parts = chunkSnapshot(records, 'm-1');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(seal(key, { v: 1, msgId: 'm-1', ops: [p] }, aad).length).toBeLessThan(
        MAX_MESSAGE_BYTES,
      );
    }
    expect(reassemble(parts)).toEqual(records);
    const shuffled = [...parts, ...parts]
      .reverse()
      .sort((a, b) => ((a.part * 7) % 5) - ((b.part * 7) % 5));
    expect(reassemble(shuffled)).toEqual(records);
  });

  it('is incomplete until every part is present', () => {
    const parts = chunkSnapshot(
      Array.from({ length: 80 }, (_, i) => rec(i, 1000)),
      'm-1',
    );
    expect(reassemble(parts.slice(1))).toBeNull();
    expect(reassemble([])).toBeNull();
  });

  it('empty snapshot is one empty part; an oversize record throws', () => {
    expect(chunkSnapshot([], 'm')).toEqual([{ op: 'snapshot', part: 0, of: 1, records: [] }]);
    expect(() => chunkSnapshot([rec(1, 70000)], 'm')).toThrow(/too large/);
  });
});

const KAT =
  '6465666768696a6b6c6d6e6f707172737475767778797a7b07518f92c51fa5a0ea43fa76c24d87eb368a705dc643bac3ae6f3fdc093108329124271b4094dbe583624726762e2a7d4c8dbc7cbd881697f53f312cbaaac3312b022b291e2eb48c34bff008b610161083';
