import { describe, expect, it } from 'vitest';

import { decideAuthRedirect } from '../src/lib/authRedirect';

const base = { loading: false, signedIn: false, dev: false, flags: { paywall: false } };
const link = 'waves:///join?token=abc';

describe('decideAuthRedirect', () => {
  it('keeps a signed-out cold start from an invite link: empty segments do not redirect', () => {
    expect(decideAuthRedirect({ ...base, segments: [], initialUrl: link })).toBe('stay');
    expect(
      decideAuthRedirect({ ...base, segments: [], initialUrl: 'https://app.wavs.co.in/join#abc' }),
    ).toBe('stay');
  });

  it('waits while the launch URL is still being read', () => {
    expect(decideAuthRedirect({ ...base, segments: [], initialUrl: undefined })).toBe('wait');
    expect(
      decideAuthRedirect({ ...base, loading: true, segments: ['join'], initialUrl: link }),
    ).toBe('wait');
  });

  it('sends a signed-out plain launch to welcome', () => {
    expect(decideAuthRedirect({ ...base, segments: [], initialUrl: null })).toBe('welcome');
    expect(decideAuthRedirect({ ...base, segments: ['(tabs)'], initialUrl: null })).toBe('welcome');
  });

  it('still guards a deep link to a private screen once the route is known', () => {
    expect(decideAuthRedirect({ ...base, segments: ['settle-up'], initialUrl: link })).toBe(
      'welcome',
    );
  });

  it('lets the invite and doors stay when signed out', () => {
    expect(decideAuthRedirect({ ...base, segments: ['join'], initialUrl: link })).toBe('stay');
    expect(decideAuthRedirect({ ...base, segments: ['welcome'], initialUrl: null })).toBe('stay');
  });

  it('moves a signed-in person off a door', () => {
    expect(
      decideAuthRedirect({ ...base, signedIn: true, segments: ['welcome'], initialUrl: null }),
    ).toBe('home');
    expect(decideAuthRedirect({ ...base, signedIn: true, segments: [], initialUrl: null })).toBe(
      'stay',
    );
  });
});
