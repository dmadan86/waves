/**
 * The consent behind session replay: off by default, off on every failure to
 * read, and a failed write throws so the switch is never left lying.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyStoredSessionReplayConsent,
  sessionReplayConsent,
  setSessionReplayConsent,
} from '../src/lib/sessionReplay';

const h = vi.hoisted(() => ({ configured: true, allowSessionReplay: vi.fn() }));

vi.mock('../src/lib/clarity', () => ({
  get clarityConfigured() {
    return h.configured;
  },
  allowSessionReplay: h.allowSessionReplay,
}));
vi.mock('../src/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));

const KEY = 'waves.session_replay_consent';

beforeEach(async () => {
  vi.restoreAllMocks();
  h.allowSessionReplay.mockReset().mockResolvedValue(undefined);
  h.configured = true;
  await AsyncStorage.clear();
});

describe('sessionReplayConsent', () => {
  it('is off until somebody turns it on', async () => {
    await expect(sessionReplayConsent()).resolves.toBe(false);
    await AsyncStorage.setItem(KEY, 'true');
    await expect(sessionReplayConsent()).resolves.toBe(true);
    await AsyncStorage.setItem(KEY, 'yes');
    await expect(sessionReplayConsent()).resolves.toBe(false);
  });

  it('is off when the store cannot be read', async () => {
    await AsyncStorage.setItem(KEY, 'true');
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('locked'));
    await expect(sessionReplayConsent()).resolves.toBe(false);
  });

  it('is off without a Clarity account, whatever is stored', async () => {
    await AsyncStorage.setItem(KEY, 'true');
    h.configured = false;
    await expect(sessionReplayConsent()).resolves.toBe(false);
  });
});

describe('setSessionReplayConsent', () => {
  it('stores the choice and acts on it', async () => {
    await setSessionReplayConsent(true);
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('true');
    expect(h.allowSessionReplay).toHaveBeenLastCalledWith(true);

    await setSessionReplayConsent(false);
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('false');
    expect(h.allowSessionReplay).toHaveBeenLastCalledWith(false);
  });

  it('throws on a failed write and does not touch capture', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(setSessionReplayConsent(true)).rejects.toThrow('disk full');
    expect(h.allowSessionReplay).not.toHaveBeenCalled();
  });
});

describe('applyStoredSessionReplayConsent', () => {
  it('resumes only for someone who opted in', async () => {
    await applyStoredSessionReplayConsent();
    expect(h.allowSessionReplay).not.toHaveBeenCalled();

    await AsyncStorage.setItem(KEY, 'true');
    await applyStoredSessionReplayConsent();
    expect(h.allowSessionReplay).toHaveBeenCalledWith(true);
  });

  it('does nothing without a Clarity account', async () => {
    await AsyncStorage.setItem(KEY, 'true');
    h.configured = false;
    await applyStoredSessionReplayConsent();
    expect(h.allowSessionReplay).not.toHaveBeenCalled();
  });
});
