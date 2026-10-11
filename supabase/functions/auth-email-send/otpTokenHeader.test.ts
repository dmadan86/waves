import { describe, expect, it } from 'vitest';

import { isCanonicalHttpsOrigin, otpTokenHeader } from './otpTokenHeader.ts';

const ORIGIN = 'https://wavs.co.in';

describe('otpTokenHeader', () => {
  it('serializes the draft example', () => {
    expect(otpTokenHeader('123456', ORIGIN)).toBe('"123456"; origin="https://wavs.co.in"');
  });

  it('escapes quotes and backslashes in the code', () => {
    expect(otpTokenHeader('a"b\\c', ORIGIN)).toBe('"a\\"b\\\\c"; origin="https://wavs.co.in"');
  });

  it('round-trips awkward codes through an SF string parser', () => {
    const parse = (header: string): string => {
      const match = /^"((?:[^"\\]|\\["\\])*)"; origin="https:\/\/wavs\.co\.in"$/.exec(header);
      if (!match) throw new Error(`not a valid item: ${header}`);
      return match[1].replace(/\\(["\\])/g, '$1');
    };
    const alphabet = ['"', '\\', 'a', '1', ' ', ';', '=', '\\"', '"\\'];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 300; i += 1) {
      let code = '';
      const len = 1 + (next() % 12);
      for (let j = 0; j < len; j += 1) code += alphabet[next() % alphabet.length];
      const header = otpTokenHeader(code, ORIGIN);
      expect(header).not.toBeNull();
      expect(parse(header as string)).toBe(code);
    }
  });

  it('omits the header for an empty code', () => {
    expect(otpTokenHeader('', ORIGIN)).toBeNull();
  });

  it('omits the header for characters an SF string cannot carry', () => {
    expect(otpTokenHeader('12\r\n56', ORIGIN)).toBeNull();
    expect(otpTokenHeader('12\u00e956', ORIGIN)).toBeNull();
    expect(otpTokenHeader('12\u007f', ORIGIN)).toBeNull();
  });

  it.each([
    'http://wavs.co.in',
    'https://WAVS.co.in',
    'https://wavs.co.in/',
    'https://wavs.co.in/path',
    'https://wavs.co.in:443',
    'https://wavs.co.in?x=1',
    'https://user@wavs.co.in',
    'https://',
    'wavs.co.in',
    '',
    'https://wavs.co.in:0',
    'https://wavs.co.in:99999',
    'https://wavs.co.in"; x="',
  ])('rejects origin %j', (origin) => {
    expect(otpTokenHeader('123456', origin)).toBeNull();
  });

  it('accepts a non-default port and subdomains', () => {
    expect(isCanonicalHttpsOrigin('https://app.wavs.co.in:8443')).toBe(true);
    expect(otpTokenHeader('1', 'https://app.wavs.co.in:8443')).toBe(
      '"1"; origin="https://app.wavs.co.in:8443"',
    );
  });
});
