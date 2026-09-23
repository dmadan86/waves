/**
 * The one place the Firebase native modules are named.
 *
 * Both loaders exist to answer "does this build have it?" without ever
 * throwing, because a binary built before Firebase was added must keep
 * launching after a JavaScript-only update. The packages are reached by a lazy
 * `require`, which `vi.mock` cannot substitute — so these tests stand in for
 * Node's own `require` and hand back whatever shape each case needs.
 */

import Module from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadFirebaseAppCheck, loadFirebaseAuth } from '../src/lib/firebaseModule';

type Loader = (this: unknown, id: string) => unknown;

/** Answer the listed ids, throw "not installed" for any other Firebase id. */
function packages(installed: Record<string, unknown>) {
  const original = Module.prototype.require as unknown as Loader;
  vi.spyOn(Module.prototype, 'require').mockImplementation(function (this: unknown, id: string) {
    if (id in installed) return installed[id];
    if (id.startsWith('@react-native-firebase/')) throw new Error(`Cannot find module '${id}'`);
    return original.call(this, id);
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the phone sign-in module', () => {
  it('is handed back when the build carries it', () => {
    const auth = () => ({});
    packages({ '@react-native-firebase/auth': { default: auth } });
    expect(loadFirebaseAuth()).toBe(auth);
  });

  it('is null, not a crash, on a build without it', () => {
    packages({});
    expect(loadFirebaseAuth()).toBeNull();
  });

  it('is null when the package loads but exports nothing usable', () => {
    packages({ '@react-native-firebase/auth': {} });
    expect(loadFirebaseAuth()).toBeNull();
  });
});

describe('App Check', () => {
  const getApp = () => 'app';
  const initializeAppCheck = async () => ({});

  it('is handed back when both halves are present', () => {
    packages({
      '@react-native-firebase/app': { getApp },
      '@react-native-firebase/app-check': { initializeAppCheck },
    });
    expect(loadFirebaseAppCheck()).toEqual({ getApp, initializeAppCheck });
  });

  it('is null on an older binary that has the app module but not App Check', () => {
    packages({ '@react-native-firebase/app': { getApp } });
    expect(loadFirebaseAppCheck()).toBeNull();
  });

  it('is null when either half is the wrong shape', () => {
    packages({
      '@react-native-firebase/app': { getApp },
      '@react-native-firebase/app-check': {},
    });
    expect(loadFirebaseAppCheck()).toBeNull();

    vi.restoreAllMocks();
    packages({
      '@react-native-firebase/app': {},
      '@react-native-firebase/app-check': { initializeAppCheck },
    });
    expect(loadFirebaseAppCheck()).toBeNull();
  });
});
