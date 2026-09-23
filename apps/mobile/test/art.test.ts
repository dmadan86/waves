/**
 * Remote artwork URLs: the public bucket by default, an override when a build
 * names one, and never a doubled or missing slash between the two halves.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadArt() {
  vi.resetModules();
  return import('../src/lib/art');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('artUrl', () => {
  it('points at the public art domain when no override is set', async () => {
    vi.stubEnv('EXPO_PUBLIC_ART_BASE_URL', undefined as unknown as string);
    const { artUrl } = await loadArt();
    expect(artUrl('feedback/voice.png')).toBe('https://assets.wavs.co.in/feedback/voice.png');
  });

  it('joins with exactly one slash however the path is written', async () => {
    vi.stubEnv('EXPO_PUBLIC_ART_BASE_URL', undefined as unknown as string);
    const { artUrl } = await loadArt();
    expect(artUrl('//feedback/voice.png')).toBe('https://assets.wavs.co.in/feedback/voice.png');
  });

  it('takes an overridden base, trailing slashes and all', async () => {
    vi.stubEnv('EXPO_PUBLIC_ART_BASE_URL', 'http://localhost:9000/art///');
    const { artUrl } = await loadArt();
    expect(artUrl('/a.png')).toBe('http://localhost:9000/art/a.png');
  });
});
