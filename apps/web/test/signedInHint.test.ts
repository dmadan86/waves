import { describe, expect, it } from 'vitest';

import { signedInCookie } from '../src/lib/signedInHint';

describe('signed-in marker for the website', () => {
  it('is shared with wavs.co.in from the app host', () => {
    expect(signedInCookie(true, 'app.wavs.co.in')).toBe(
      'waves_signed_in=1; Max-Age=2592000; Path=/; SameSite=Lax; Secure; Domain=wavs.co.in',
    );
  });
  it('is cleared on sign-out', () => {
    expect(signedInCookie(false, 'app.wavs.co.in')).toContain('waves_signed_in=; Max-Age=0');
  });
  it('stays on its own host anywhere else', () => {
    expect(signedInCookie(true, 'localhost')).not.toContain('Domain');
    expect(signedInCookie(true, 'evilwavs.co.in')).not.toContain('Domain');
  });
});
