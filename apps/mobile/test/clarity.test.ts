/**
 * Session replay. The promise this module keeps: off without a project id,
 * paused the instant it starts, only resumed by an explicit allow — and never
 * the reason the app fails to launch.
 *
 * The SDK is reached by `require`, which `vi.mock` does not intercept, so the
 * stub goes in Node's require cache.
 */

import { createRequire } from 'node:module';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nodeRequire = createRequire(import.meta.url);
const sdkPath = nodeRequire.resolve('@microsoft/react-native-clarity');

const sdk = {
  LogLevel: { None: 'none' },
  initialize: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  consent: vi.fn(),
  setCurrentScreenName: vi.fn(),
};

function stubSdk(exports: unknown): void {
  nodeRequire.cache[sdkPath] = {
    id: sdkPath,
    filename: sdkPath,
    loaded: true,
    exports,
  } as never;
}

function breakSdk(): void {
  // A getter that throws stands in for a build without the native module.
  Object.defineProperty(nodeRequire.cache, sdkPath, {
    configurable: true,
    get() {
      throw new Error('native module missing');
    },
  });
}

async function load(projectId: string) {
  vi.stubEnv('EXPO_PUBLIC_CLARITY_PROJECT_ID', projectId);
  vi.resetModules();
  return import('../src/lib/clarity');
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.pause.mockResolvedValue(undefined);
  sdk.resume.mockResolvedValue(undefined);
  sdk.consent.mockResolvedValue(undefined);
  sdk.setCurrentScreenName.mockResolvedValue(undefined);
  stubSdk(sdk);
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete nodeRequire.cache[sdkPath];
});

afterAll(() => {
  delete nodeRequire.cache[sdkPath];
});

describe('without a project id', () => {
  it('does nothing at all', async () => {
    const clarity = await load('');
    expect(clarity.clarityConfigured).toBe(false);
    clarity.initClarity();
    await clarity.allowSessionReplay(true);
    await clarity.noteScreen('home');
    expect(sdk.initialize).not.toHaveBeenCalled();
    expect(sdk.resume).not.toHaveBeenCalled();
    expect(sdk.setCurrentScreenName).not.toHaveBeenCalled();
  });
});

describe('with a project id', () => {
  it('starts paused, and only once', async () => {
    const clarity = await load('proj');
    clarity.initClarity();
    clarity.initClarity();
    expect(sdk.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.initialize).toHaveBeenCalledWith('proj', { logLevel: 'none' });
    expect(sdk.pause).toHaveBeenCalledTimes(1);
  });

  it('ignores consent and screen names before it has started', async () => {
    const clarity = await load('proj');
    await clarity.allowSessionReplay(true);
    await clarity.noteScreen('home');
    expect(sdk.consent).not.toHaveBeenCalled();
    expect(sdk.setCurrentScreenName).not.toHaveBeenCalled();
  });

  it('resumes on allow and pauses on revoke, never granting ads storage', async () => {
    const clarity = await load('proj');
    clarity.initClarity();
    sdk.pause.mockClear();

    await clarity.allowSessionReplay(true);
    expect(sdk.consent).toHaveBeenLastCalledWith(false, true);
    expect(sdk.resume).toHaveBeenCalledTimes(1);

    await clarity.allowSessionReplay(false);
    expect(sdk.consent).toHaveBeenLastCalledWith(false, false);
    expect(sdk.pause).toHaveBeenCalledTimes(1);
  });

  it('names the screen once started', async () => {
    const clarity = await load('proj');
    clarity.initClarity();
    await clarity.noteScreen('group');
    expect(sdk.setCurrentScreenName).toHaveBeenCalledWith('group');
  });

  it('swallows every SDK failure', async () => {
    const clarity = await load('proj');
    clarity.initClarity();
    sdk.consent.mockRejectedValueOnce(new Error('x'));
    sdk.setCurrentScreenName.mockRejectedValueOnce(new Error('x'));
    await expect(clarity.allowSessionReplay(true)).resolves.toBeUndefined();
    await expect(clarity.noteScreen('home')).resolves.toBeUndefined();
  });

  it('does not count as started when initialize throws', async () => {
    const clarity = await load('proj');
    sdk.initialize.mockImplementationOnce(() => {
      throw new Error('bad id');
    });
    expect(() => clarity.initClarity()).not.toThrow();
    await clarity.allowSessionReplay(true);
    expect(sdk.consent).not.toHaveBeenCalled();
  });

  it('stays quiet on a build without the native module', async () => {
    const clarity = await load('proj');
    breakSdk();
    expect(() => clarity.initClarity()).not.toThrow();
    expect(sdk.initialize).not.toHaveBeenCalled();
  });

  it('stays quiet when the module disappears after start', async () => {
    const clarity = await load('proj');
    clarity.initClarity();
    breakSdk();
    await expect(clarity.allowSessionReplay(true)).resolves.toBeUndefined();
    await expect(clarity.noteScreen('home')).resolves.toBeUndefined();
    expect(sdk.consent).not.toHaveBeenCalled();
    expect(sdk.setCurrentScreenName).not.toHaveBeenCalled();
  });
});
