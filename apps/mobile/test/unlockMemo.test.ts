import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knownInitialUrl, readInitialUrl, resetInitialUrl } from '@/lib/initialUrl';
import { forgetTours, knownOnboardingSeen, onboardingSeen } from '@/lib/onboardingSeen';

const getInitialURL = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-linking', () => ({ getInitialURL: () => getInitialURL() }));

describe('state the navigator needs on remount after an unlock', () => {
  beforeEach(() => {
    resetInitialUrl();
    getInitialURL.mockReset();
  });

  it('reads the launch link once and answers synchronously afterwards', async () => {
    getInitialURL.mockResolvedValue('waves://join/abc');
    expect(knownInitialUrl()).toBeUndefined();
    await Promise.all([readInitialUrl(), readInitialUrl()]);
    expect(knownInitialUrl()).toBe('waves://join/abc');
    await readInitialUrl();
    expect(getInitialURL).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable launch link as none', async () => {
    getInitialURL.mockRejectedValue(new Error('no'));
    await readInitialUrl();
    expect(knownInitialUrl()).toBeNull();
  });

  it('knows the per-account tour answer without asking storage again', async () => {
    expect(knownOnboardingSeen('u1')).toBeUndefined();
    await onboardingSeen('u1');
    expect(typeof knownOnboardingSeen('u1')).toBe('boolean');
    expect(knownOnboardingSeen('u2')).toBeUndefined();
    await forgetTours('u1');
    expect(knownOnboardingSeen('u1')).toBeUndefined();
  });
});
