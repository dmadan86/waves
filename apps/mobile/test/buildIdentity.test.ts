/**
 * The build identity read off the binary: which field is the build number
 * depends on the platform, and anything missing reads as null, not "undefined".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildIdentity, buildStamp } from '../src/lib/buildIdentity';

const native = vi.hoisted(() => ({
  platform: { OS: 'ios' as string },
  constants: { expoConfig: undefined as unknown },
}));

vi.mock('react-native', () => ({ Platform: native.platform }));
vi.mock('expo-constants', () => ({ default: native.constants }));

const CONFIG = {
  version: '2.3.0',
  ios: { buildNumber: '41' },
  android: { versionCode: 107 },
  extra: { commit: 'abc1234' },
};

beforeEach(() => {
  native.platform.OS = 'ios';
  native.constants.expoConfig = CONFIG;
});

describe('buildIdentity', () => {
  it('reads the iOS build number on iOS', () => {
    expect(buildIdentity()).toEqual({ version: '2.3.0', build: '41', commit: 'abc1234' });
  });

  it('reads the Android version code, as a string, on Android', () => {
    native.platform.OS = 'android';
    expect(buildIdentity()).toEqual({ version: '2.3.0', build: '107', commit: 'abc1234' });
  });

  it('reports null for everything a config does not carry', () => {
    native.constants.expoConfig = { extra: { commit: 42 } };
    expect(buildIdentity()).toEqual({ version: null, build: null, commit: null });
    native.constants.expoConfig = null;
    expect(buildIdentity()).toEqual({ version: null, build: null, commit: null });
  });

  it('formats a stamp that names the version, build and commit', () => {
    const stamp = buildStamp();
    expect(stamp).toContain('2.3.0');
    expect(stamp).toContain('41');
    expect(stamp).toContain('abc1234');
  });
});
