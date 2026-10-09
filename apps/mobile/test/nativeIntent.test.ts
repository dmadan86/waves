/**
 * What the app does with a link the OS hands it.
 *
 * `redirectSystemPath` is the first code a cold launch from a link runs, before
 * the app context exists. Two things are checked here: that an invite arriving
 * as an Android App Link reaches the join screen *with its token* — the failure
 * this is written for is the silent one, where the fragment is dropped and the
 * screen asks for a code the person was already holding — and that the module
 * imports cleanly with no native mocks at all, which is why the link parser was
 * split out of `qrScan` in the first place.
 */

import { describe, expect, it } from 'vitest';

import { redirectSystemPath } from '@/app/+native-intent';

const go = (path: string): string | null => redirectSystemPath({ path, initial: true });

describe("Firebase's phone check returning from reCAPTCHA", () => {
  const link =
    'waves://firebaseauth/link?deep_link_id=https%3A%2F%2Fwaves-3e7b8.firebaseapp.com%2F__%2Fauth%2Fcallback%3FauthType%3DverifyApp';

  it('is left to Firebase while the app is open', () => {
    expect(redirectSystemPath({ path: link, initial: false })).toBeNull();
    expect(
      redirectSystemPath({
        path: 'app-1-654054834944-ios-a1864d97b1dd417368e9e5://firebaseauth/link?x=1',
        initial: false,
      }),
    ).toBeNull();
    expect(redirectSystemPath({ path: '/firebaseauth/link?x=1', initial: false })).toBeNull();
  });

  it('lands on Home if it ever starts the app', () => {
    expect(go(link)).toBe('/');
  });
});

describe('an invite arriving as an App Link', () => {
  it('carries the fragment token through to the join screen', () => {
    expect(go('https://app.wavs.co.in/join#abc123')).toBe('/join?token=abc123');
  });

  it('reads the older path and query shapes too', () => {
    expect(go('https://app.wavs.co.in/join/abc123')).toBe('/join?token=abc123');
    expect(go('https://app.wavs.co.in/join?token=abc123')).toBe('/join?token=abc123');
  });

  it('escapes a token before putting it in a query', () => {
    expect(go('https://app.wavs.co.in/join#a%20b')).toBe('/join?token=a%20b');
  });

  it('refuses a link whose two shapes name different groups', () => {
    // Somebody splicing `?token=` onto a forwarded link: the browser would join
    // the fragment's group and the app the query's. Neither, then — the URL
    // passes through and the join screen asks for a code.
    const spliced = 'https://app.wavs.co.in/join?token=attacker#real';
    expect(go(spliced)).toBe(spliced);
  });

  it('leaves an https link that is not one of ours alone', () => {
    expect(go('https://evil.example/join#abc123')).toBe('https://evil.example/join#abc123');
    expect(go('https://app.wavs.co.in/groups')).toBe('https://app.wavs.co.in/groups');
  });
});

describe('the links that were already rewritten', () => {
  it('sends a finished OAuth callback to the root, not to a missing route', () => {
    expect(go('waves://auth?code=x')).toBe('/');
    expect(go('waves:///auth?code=x')).toBe('/');
  });

  it('sends an old Drive consent redirect back to the backup screen', () => {
    expect(go('waves://oauthredirect')).toBe('/settings/backup');
  });

  it('gives the scan widget a fresh nonce on every tap', () => {
    const first = go('waves://capture?scan=1');
    expect(first).toMatch(/^\/capture\?scan=\d+$/);
  });

  it('gives the Photo tile a fresh gallery nonce on every tap', () => {
    expect(go('waves:///capture?gallery=1')).toMatch(/^\/capture\?gallery=\d+$/);
  });

  it('lets a search-widget chip preset a built-in category, and only a built-in one', () => {
    expect(go('waves:///capture?category=food')).toBe('/capture?category=food');
    expect(go('waves:///capture?category=travel')).toBe('/capture?category=travel');
    expect(go('waves:///capture?category=shopping')).toBe('/capture?category=shopping');
    // An id the app does not ship still opens quick add, without the preset.
    expect(go('waves:///capture?category=not-a-thing')).toBe('/capture');
  });

  it('passes anything it does not recognise straight through', () => {
    expect(go('waves://group/abc')).toBe('waves://group/abc');
    expect(go('not a url at all')).toBe('not a url at all');
  });
});

describe('the voice widget handing over what it heard', () => {
  // `VoiceCaptureActivity` opens exactly this shape. The voice screen reads
  // `heard` and `hn` off it; anything that rewrote it — to `/`, or with the
  // query dropped — is the "opened the dashboard and did nothing" bug.
  const link = 'waves:///voice?heard=Add%2080%20for%20lunch&hn=1759398740000';

  it('reaches the voice screen untouched on a cold start', () => {
    expect(redirectSystemPath({ path: link, initial: true })).toBe(link);
  });

  it('reaches the voice screen untouched while the app is already open', () => {
    expect(redirectSystemPath({ path: link, initial: false })).toBe(link);
  });

  it('opens the voice screen even when nothing was heard', () => {
    expect(redirectSystemPath({ path: 'waves:///voice', initial: true })).toBe('waves:///voice');
  });
});
