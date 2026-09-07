import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  requireOptionalNativeModule: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: native.platform }));
vi.mock('expo', () => ({ requireOptionalNativeModule: native.requireOptionalNativeModule }));

const { cameraAvailable, tokenFromScan } = await import('../src/lib/qrScan');

beforeEach(() => {
  native.platform.OS = 'ios';
  native.requireOptionalNativeModule.mockReset();
});

describe('cameraAvailable', () => {
  it('requires an iOS or Android binary that actually includes ExpoCamera', () => {
    native.requireOptionalNativeModule.mockReturnValue({});
    native.platform.OS = 'ios';
    expect(cameraAvailable()).toBe(true);

    native.platform.OS = 'android';
    expect(cameraAvailable()).toBe(true);

    native.platform.OS = 'web';
    expect(cameraAvailable()).toBe(false);
    expect(native.requireOptionalNativeModule).toHaveBeenCalledTimes(2);
  });

  it('returns false for native dev clients built without the camera module', () => {
    native.platform.OS = 'android';
    native.requireOptionalNativeModule.mockReturnValue(null);

    expect(cameraAvailable()).toBe(false);
  });
});

describe('tokenFromScan', () => {
  it('extracts tokens from the supported HTTPS and app deep-link invite URLs', () => {
    expect(tokenFromScan(' https://app.wavs.co.in/join?token=abc123 ')).toBe('abc123');
    expect(tokenFromScan('https://APP.WAVS.CO.IN/join/?token=a%20b')).toBe('a b');
    expect(tokenFromScan('waves://join?token=wave-token')).toBe('wave-token');
    expect(tokenFromScan('waves:///join?token=triple-slash')).toBe('triple-slash');
  });

  it('reads the fragment form the invite QR actually paints', () => {
    // `groupJoinLink` writes `…/join#<token>`: the token stays in the fragment
    // so it never reaches a server, a proxy or a Referer header. This is the
    // shape every QR in the app encodes, so it is the one that matters most.
    expect(tokenFromScan('https://app.wavs.co.in/join#frag-token')).toBe('frag-token');
    expect(tokenFromScan(' https://APP.WAVS.CO.IN/join/#a%20b ')).toBe('a b');
    expect(tokenFromScan('waves://join#deep-frag')).toBe('deep-frag');
    expect(tokenFromScan('waves:///join#triple-frag')).toBe('triple-frag');
  });

  it('reads the older path form the web app still serves', () => {
    expect(tokenFromScan('https://app.wavs.co.in/join/path-token')).toBe('path-token');
    expect(tokenFromScan('https://app.wavs.co.in/join/path-token/')).toBe('path-token');
    expect(tokenFromScan('waves://join/deep-path')).toBe('deep-path');
    expect(tokenFromScan('waves:///join/triple-path')).toBe('triple-path');
  });

  it('rejects join URLs that carry no token in any of the three places', () => {
    for (const data of [
      'https://app.wavs.co.in/join',
      'https://app.wavs.co.in/join/',
      'https://app.wavs.co.in/join#',
      'https://app.wavs.co.in/join#%20',
      // A token is one path segment; a deeper path is some other page of ours.
      'https://app.wavs.co.in/join/a/b',
      'waves://join',
    ]) {
      expect(tokenFromScan(data)).toBeNull();
    }
  });

  it('rejects unrelated hosts, paths, schemes and blank token values', () => {
    for (const data of [
      '',
      'not a url',
      'http://app.wavs.co.in/join?token=abc',
      'https://evil.example/join?token=abc',
      'https://app.wavs.co.in/not-join?token=abc',
      'waves://evil.example/join?token=abc',
      'mailto:test@example.com?token=abc',
      'https://app.wavs.co.in/join?token=',
      'https://app.wavs.co.in/join?token=%20%20',
    ]) {
      expect(tokenFromScan(data)).toBeNull();
    }
  });

  it('prefers the token a server would have honoured over one appended after it', () => {
    expect(tokenFromScan('https://app.wavs.co.in/join?token=abc#token=evil')).toBe('abc');
    expect(tokenFromScan('https://app.wavs.co.in/join?other=1&token=abc#frag')).toBe('abc');
    expect(tokenFromScan('https://app.wavs.co.in/join/path-token#frag')).toBe('path-token');
  });

  it('keeps malformed percent-encoding as the trimmed raw non-empty token', () => {
    expect(tokenFromScan('https://app.wavs.co.in/join?token=%E0%A4%A')).toBe('%E0%A4%A');
    expect(tokenFromScan('https://app.wavs.co.in/join?token=%E0%A4%A%20')).toBe('%E0%A4%A%20');
  });

  it('rejects non-invite QR payloads quickly even in a large scan batch', () => {
    const payloads = Array.from({ length: 1_000 }, (_, index) =>
      index === 999 ? 'https://app.wavs.co.in/join?token=last' : `https://example.com/${index}`,
    );

    const tokens = payloads.map(tokenFromScan).filter((token): token is string => token !== null);

    expect(tokens).toEqual(['last']);
  });
});
