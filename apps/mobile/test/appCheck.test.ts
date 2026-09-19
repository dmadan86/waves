/**
 * Coverage for App Check's start-up.
 *
 * Almost nothing here is about Firebase. What is being pinned is that this
 * file cannot take the app down or block a sign-in, in any of the states a
 * shipped binary can actually be in:
 *
 *   * the module is there and works;
 *   * the module is absent, which is every binary built before this change;
 *   * the module is there and throws, which is a device Play Integrity will
 *     not vouch for — a rooted phone, an emulator, a sideload;
 *   * the loader itself is not what this file expects.
 *
 * The last two are the ones worth having. A sign-in that refuses because
 * attestation failed would break the thing App Check exists to protect, on
 * exactly the devices least able to do anything about it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const world: {
  loader: (() => unknown) | undefined;
  initialized: unknown[];
} = { loader: undefined, initialized: [] };

vi.mock('@/lib/firebaseModule', () => ({
  loadFirebaseAppCheck: () => world.loader?.(),
}));

const { ensureAppCheck, forgetAppCheck } = await import('@/lib/appCheck');

/** A module that behaves, recording what it was asked to do. */
function working() {
  return {
    getApp: () => ({ name: '[DEFAULT]' }),
    initializeAppCheck: async (app: unknown, options: unknown) => {
      world.initialized.push({ app, options });
      return {};
    },
  };
}

beforeEach(() => {
  world.loader = working;
  world.initialized = [];
  forgetAppCheck();
  // Metro defines this in every build, so the source reads it bare, as the rest
  // of the app does. Under vitest nothing does, and a bare read of an undefined
  // global is a ReferenceError — which the code under test would swallow into a
  // `false`, quietly turning these into tests of the wrong thing.
  vi.stubGlobal('__DEV__', false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starting App Check', () => {
  it('says it is on when it is on', async () => {
    await expect(ensureAppCheck()).resolves.toBe(true);
    expect(world.initialized).toHaveLength(1);
  });

  it('asks for Play Integrity and App Attest in a release build', async () => {
    vi.stubGlobal('__DEV__', false);
    await ensureAppCheck();

    const { options } = world.initialized[0] as {
      options: {
        provider: {
          providerOptions: { android: { provider: string }; apple: { provider: string } };
        };
        isTokenAutoRefreshEnabled: boolean;
      };
    };
    expect(options.provider.providerOptions.android.provider).toBe('playIntegrity');
    expect(options.provider.providerOptions.apple.provider).toBe(
      'appAttestWithDeviceCheckFallback',
    );
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
  });

  it('asks for the debug provider in development', async () => {
    // Play Integrity wants a binary Google signed, which a debug APK is not.
    vi.stubGlobal('__DEV__', true);
    await ensureAppCheck();

    const { options } = world.initialized[0] as {
      options: { provider: { providerOptions: { android: { provider: string } } } };
    };
    expect(options.provider.providerOptions.android.provider).toBe('debug');
  });

  it('starts once however many callers arrive', async () => {
    // Two at once is ordinary: the screen mounts and the person taps.
    const [a, b] = await Promise.all([ensureAppCheck(), ensureAppCheck()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(world.initialized).toHaveLength(1);
  });
});

describe('when it cannot start', () => {
  it('answers false on a build with no App Check in it', async () => {
    // Every binary made before this change. Not an error — the expected state.
    world.loader = () => null;
    await expect(ensureAppCheck()).resolves.toBe(false);
  });

  it('answers false rather than rejecting when the module throws', async () => {
    // A device Play Integrity will not vouch for. The sign-in must go on and
    // let Firebase decide; refusing here would lock out the people least able
    // to do anything about it.
    world.loader = () => ({
      getApp: () => ({}),
      initializeAppCheck: async () => {
        throw new Error('no integrity verdict on this device');
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(ensureAppCheck()).resolves.toBe(false);
  });

  it('answers false rather than rejecting when getApp throws', async () => {
    // Firebase not initialised at all — a config file that did not make it
    // into the build.
    world.loader = () => ({
      getApp: () => {
        throw new Error('no default app');
      },
      initializeAppCheck: async () => ({}),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(ensureAppCheck()).resolves.toBe(false);
  });

  it('answers false rather than rejecting when the loader itself is missing', async () => {
    // The guarantee has to hold even where the module is not the shape this
    // file expects — a partial mock, a package reshaped by a major bump. It is
    // only worth having if it survives the case nobody predicted.
    world.loader = () => {
      throw new TypeError('loadFirebaseAppCheck is not a function');
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(ensureAppCheck()).resolves.toBe(false);
  });
});
