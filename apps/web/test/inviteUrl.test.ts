import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('invite links', () => {
  it('use the old app host when mounted under the site, so the phone app opens them', async () => {
    vi.stubEnv('NEXT_PUBLIC_INVITE_ORIGIN', 'https://app.wavs.co.in');
    const { inviteUrl } = await import('../src/lib/basePath');
    expect(inviteUrl('tok')).toBe('https://app.wavs.co.in/join#tok');
  });
});
