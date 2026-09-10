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

const go = (path: string): string => redirectSystemPath({ path, initial: true });

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

  it('passes anything it does not recognise straight through', () => {
    expect(go('waves://group/abc')).toBe('waves://group/abc');
    expect(go('not a url at all')).toBe('not a url at all');
  });
});
