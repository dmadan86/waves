import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  hmacSha1,
  matchTotp,
  otpauthUri,
  sha1,
  totpAt,
  totpSecondsLeft,
  totpStep,
} from '../src/auth/totp';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const ascii = (text: string) => new TextEncoder().encode(text);
// RFC 6238 appendix B SHA-1 seed.
const SEED = ascii('12345678901234567890');

describe('sha1 / hmac', () => {
  it('matches FIPS 180 vectors', () => {
    expect(hex(sha1(ascii('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(ascii('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(ascii('a'.repeat(1000))))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
  });
  it('matches RFC 2202 HMAC-SHA1', () => {
    expect(hex(hmacSha1(new Uint8Array(20).fill(0x0b), ascii('Hi There')))).toBe(
      'b617318655057264e28bc0b6fb378c8ef146be00',
    );
    expect(
      hex(
        hmacSha1(
          new Uint8Array(80).fill(0xaa),
          ascii('Test Using Larger Than Block-Size Key - Hash Key First'),
        ),
      ),
    ).toBe('aa4ae5e15272d00e95705637ce8a3b55ed402112');
  });
});

describe('RFC 6238 SHA-1 vectors', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it.each(vectors)('T=%i', (time, code) => {
    expect(totpAt(SEED, totpStep(time * 1000), 8)).toBe(code);
    expect(totpAt(SEED, totpStep(time * 1000))).toBe(code.slice(2));
  });
});

describe('matchTotp', () => {
  const now = 1111111111 * 1000;
  const step = totpStep(now);
  it('accepts the current and ±1 step, returning which', () => {
    expect(matchTotp(SEED, totpAt(SEED, step), now)).toBe(step);
    expect(matchTotp(SEED, totpAt(SEED, step - 1), now)).toBe(step - 1);
    expect(matchTotp(SEED, totpAt(SEED, step + 1), now)).toBe(step + 1);
  });
  it('refuses ±2 steps and junk', () => {
    expect(matchTotp(SEED, totpAt(SEED, step - 2), now)).toBeNull();
    expect(matchTotp(SEED, totpAt(SEED, step + 2), now)).toBeNull();
    expect(matchTotp(SEED, '12345', now)).toBeNull();
    expect(matchTotp(SEED, 'abcdef', now)).toBeNull();
  });
  it('forgives a space in the typed code', () => {
    const code = totpAt(SEED, step);
    expect(matchTotp(SEED, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step);
  });
});

describe('base32 + otpauth', () => {
  it('round-trips and matches RFC 4648', () => {
    expect(base32Encode(ascii('foobar'))).toBe('MZXW6YTBOI');
    expect(hex(base32Decode('mzxw 6ytb-oi')!)).toBe(hex(ascii('foobar')));
    expect(base32Decode('not base32!')).toBeNull();
    expect(base32Decode(base32Encode(SEED))).toEqual(SEED);
  });
  it('builds an authenticator link', () => {
    expect(otpauthUri('ABC', 'a@b.c')).toBe(
      'otpauth://totp/Waves%3Aa%40b.c?secret=ABC&issuer=Waves&algorithm=SHA1&digits=6&period=30',
    );
  });
  it('counts down the 30 seconds', () => {
    expect(totpSecondsLeft(0)).toBe(30);
    expect(totpSecondsLeft(29_500)).toBe(1);
  });
});
