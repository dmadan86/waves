import { describe, expect, it } from 'vitest';

import {
  beginCheck,
  canDeviceLock,
  checking,
  endCheck,
  lockAwayTransition,
  resolveLockEnabled,
  shouldRelock,
} from '../src/lib/appLock';

describe('default-on rule', () => {
  it('can lock only with hardware plus biometrics or a passcode', () => {
    expect(canDeviceLock(true, true, true)).toBe(true); // enrolled biometrics
    expect(canDeviceLock(true, false, false)).toBe(true); // device passcode only
    expect(canDeviceLock(true, false, true)).toBe(false); // nothing set up
    expect(canDeviceLock(false, true, false)).toBe(false); // no hardware
  });

  it('is on when nothing is stored, off only for an explicit false', () => {
    expect(resolveLockEnabled(null, true)).toBe(true);
    expect(resolveLockEnabled('true', true)).toBe(true);
    expect(resolveLockEnabled('false', true)).toBe(false);
    expect(resolveLockEnabled(null, false)).toBe(false);
    expect(resolveLockEnabled('true', false)).toBe(false);
  });
});

describe('grace window', () => {
  it('re-locks at or past the window, not before', () => {
    expect(shouldRelock(29_999, 30)).toBe(false);
    expect(shouldRelock(30_000, 30)).toBe(true);
    expect(shouldRelock(0, 0)).toBe(true);
  });

  it('treats inactive and background as away, active as back', () => {
    expect(lockAwayTransition('inactive')).toBe('away');
    expect(lockAwayTransition('background')).toBe('away');
    expect(lockAwayTransition('active')).toBe('back');
    expect(lockAwayTransition('unknown')).toBe('ignore');
  });

  it('tracks our own biometric sheet', () => {
    expect(checking()).toBe(false);
    beginCheck();
    expect(checking()).toBe(true);
    endCheck();
    endCheck();
    expect(checking()).toBe(false);
  });
});
