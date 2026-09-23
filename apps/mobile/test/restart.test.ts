/**
 * Restarting the app from inside it — offered only where the build can do it,
 * and a refusal comes back as `false` rather than a throw.
 *
 * `expo-updates` is reached by `require` (after an optional-module probe that
 * never throws), so it is stubbed in Node's require cache.
 */

import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canRestart, restartApp } from '../src/lib/restart';

const h = vi.hoisted(() => ({
  os: 'android',
  native: {} as unknown,
  requireOptionalNativeModule: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return h.os;
    },
  },
}));
vi.mock('expo', () => ({ requireOptionalNativeModule: h.requireOptionalNativeModule }));

const nodeRequire = createRequire(import.meta.url);
const updatesPath = nodeRequire.resolve('expo-updates');
const reloadAsync = vi.fn();

function stubUpdates(exports: unknown): void {
  nodeRequire.cache[updatesPath] = {
    id: updatesPath,
    filename: updatesPath,
    loaded: true,
    exports,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.os = 'android';
  h.requireOptionalNativeModule.mockReturnValue({});
  reloadAsync.mockResolvedValue(undefined);
  stubUpdates({ reloadAsync });
});

afterEach(() => {
  delete nodeRequire.cache[updatesPath];
});

describe('canRestart', () => {
  it('is true on a phone build with expo-updates', () => {
    expect(canRestart()).toBe(true);
    expect(h.requireOptionalNativeModule).toHaveBeenCalledWith('ExpoUpdates');
  });

  it('is false on web, where there is nothing to restart', () => {
    h.os = 'web';
    expect(canRestart()).toBe(false);
    expect(h.requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  it('is false on a binary built before expo-updates, without requiring it', () => {
    h.requireOptionalNativeModule.mockReturnValue(null);
    stubUpdates({
      get reloadAsync() {
        throw new Error('required anyway');
      },
    });
    expect(canRestart()).toBe(false);
  });

  it('is false when the JS module has no reloadAsync, or will not load', () => {
    stubUpdates({});
    expect(canRestart()).toBe(false);
    Object.defineProperty(nodeRequire.cache, updatesPath, {
      configurable: true,
      get() {
        throw new Error('broken');
      },
    });
    expect(canRestart()).toBe(false);
  });
});

describe('restartApp', () => {
  it('reloads the runtime', async () => {
    h.os = 'ios';
    await expect(restartApp()).resolves.toBe(true);
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('answers false when it cannot, or when the reload is refused', async () => {
    reloadAsync.mockRejectedValueOnce(new Error('refused'));
    await expect(restartApp()).resolves.toBe(false);
    h.os = 'web';
    await expect(restartApp()).resolves.toBe(false);
  });
});
