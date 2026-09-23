/**
 * Voice misses go to the server — only misses, only with analytics consent,
 * never with an id, and never at the cost of breaking the mic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logVoiceAttempt } from '../src/lib/voiceLog';

const deps = vi.hoisted(() => ({
  configured: true,
  consent: vi.fn<() => Promise<boolean>>(),
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '3.1.0' } } }));
vi.mock('@/lib/backend', () => ({
  get backendConfigured() {
    return deps.configured;
  },
  backend: { rpc: (name: string, args: Record<string, unknown>) => deps.rpc(name, args) },
}));
vi.mock('@/lib/sessionReplay', () => ({ sessionReplayConsent: () => deps.consent() }));

const MISS = {
  transcript: '  hello add 500 for tea shop ',
  itemCount: 0,
  usedModel: false,
  locale: 'en',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-23T10:00:00.000Z'));
  deps.configured = true;
  deps.consent.mockReset().mockResolvedValue(true);
  deps.rpc.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('logVoiceAttempt', () => {
  it('reports a consented miss with the trimmed transcript and no identity', async () => {
    await logVoiceAttempt(MISS);
    expect(deps.rpc).toHaveBeenCalledWith('waves_log_voice_attempt', {
      p_transcript: 'hello add 500 for tea shop',
      p_locale: 'en',
      p_used_model: false,
      p_item_count: 0,
      p_platform: 'android',
      p_app_version: '3.1.0',
      p_client_at: '2026-09-23T10:00:00.000Z',
    });
  });

  it('keeps a successful parse on the device', async () => {
    await logVoiceAttempt({ ...MISS, itemCount: 2 });
    expect(deps.consent).not.toHaveBeenCalled();
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('sends nothing for silence', async () => {
    await logVoiceAttempt({ ...MISS, transcript: '   ' });
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('sends nothing on a build with no backend', async () => {
    deps.configured = false;
    await logVoiceAttempt(MISS);
    expect(deps.consent).not.toHaveBeenCalled();
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('sends nothing without analytics consent', async () => {
    deps.consent.mockResolvedValue(false);
    await logVoiceAttempt(MISS);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('swallows a failed send rather than throwing into dictation', async () => {
    deps.rpc.mockRejectedValue(new Error('offline'));
    await expect(logVoiceAttempt(MISS)).resolves.toBeUndefined();
  });
});
