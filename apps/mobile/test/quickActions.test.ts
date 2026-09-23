/**
 * The app-icon long-press menu.
 *
 * The part worth pinning down is the launch action. The native module's
 * `initial` is a constant for the life of the process, while the component that
 * acts on it is torn down and rebuilt every time the app locks or the session
 * changes — so "fires once" cannot be a guard inside that component, and these
 * tests are what says so.
 */

import { createRequire } from 'node:module';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHORTCUT_ACTIONS,
  actionForId,
  clearQuickActions,
  onQuickAction,
  routeForShortcut,
  setQuickActionsModuleForTests,
  syncQuickActions,
  takeInitialQuickAction,
} from '../src/lib/quickActions';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const TITLES = { add: 'Add an expense', scan: 'Scan a receipt', voice: 'Speak an expense' };

// The real module is reached by `require`, which `vi.mock` does not intercept.
const nodeRequire = createRequire(import.meta.url);
function stubRequire(specifier: string, exports: unknown): string {
  const path = nodeRequire.resolve(specifier);
  nodeRequire.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
  return path;
}

/** A stand-in for `expo-quick-actions`, launched from the scan shortcut. */
function fakeModule(launchedFrom: string | null = 'waves.shortcut.scan') {
  return {
    published: [] as unknown[][],
    initial: launchedFrom ? { id: launchedFrom } : null,
    setItems(items: unknown[]) {
      this.published.push(items);
    },
  };
}

let quickActions: ReturnType<typeof fakeModule>;

beforeEach(() => {
  quickActions = fakeModule();
  // Also resets the once-per-process launch guard, so each test starts at a
  // fresh cold launch.
  setQuickActionsModuleForTests(quickActions);
});

describe('app-icon quick shortcuts', () => {
  it('publishes the three user entry points in stable menu order', () => {
    expect(SHORTCUT_ACTIONS).toEqual(['add', 'scan', 'voice']);
  });

  it('ignores ids that are not Waves shortcut actions', () => {
    expect(actionForId('waves.shortcut.add')).toBe('add');
    expect(actionForId('waves.shortcut.scan')).toBe('scan');
    expect(actionForId('waves.shortcut.voice')).toBe('voice');
    expect(actionForId('waves.shortcut.settings')).toBeNull();
    expect(actionForId('other.shortcut.add')).toBeNull();
    // The id the version with a single configurable shortcut published. It is
    // still on an upgrading phone's home screen until the menu is republished,
    // and a tap on it must do nothing rather than guess an action.
    expect(actionForId('waves.shortcut')).toBeNull();
  });

  it('routes add, scan, and voice to the same places as in-app quick add', () => {
    expect(routeForShortcut('add')).toBe('/capture');
    expect(routeForShortcut('scan', 12345)).toBe('/capture?scan=12345');
    expect(routeForShortcut('voice')).toBe('/voice');
  });

  it('hands the launch action over once, however often the app is remounted', () => {
    // The first mount that can act on it — the dashboard appearing after the
    // lock screen, say — gets the action.
    expect(takeInitialQuickAction()).toBe('waves.shortcut.scan');

    // Every later mount gets nothing, though the module still reports the same
    // launch: the app locking and being unlocked again, or a sign-out and a
    // sign-in, must not reopen the camera hours after the tap that asked for it.
    expect(quickActions.initial).toEqual({ id: 'waves.shortcut.scan' });
    expect(takeInitialQuickAction()).toBeNull();
    expect(takeInitialQuickAction()).toBeNull();
  });

  it('lets a launch nobody can act on be dropped rather than left to fire later', () => {
    // A signed-out launch takes the action and throws it away, so that signing
    // in later is not answered with a screen they asked for long ago.
    takeInitialQuickAction();
    expect(takeInitialQuickAction()).toBeNull();
  });

  it('publishes the whole menu, and clears it for a signed-out phone', async () => {
    await syncQuickActions(TITLES);
    expect(quickActions.published.at(-1)).toEqual([
      {
        id: 'waves.shortcut.add',
        title: 'Add an expense',
        icon: 'symbol:plus',
        params: expect.any(Object),
      },
      {
        id: 'waves.shortcut.scan',
        title: 'Scan a receipt',
        icon: 'symbol:camera',
        params: expect.any(Object),
      },
      {
        id: 'waves.shortcut.voice',
        title: 'Speak an expense',
        icon: 'symbol:mic',
        params: expect.any(Object),
      },
    ]);

    await clearQuickActions();
    expect(quickActions.published.at(-1)).toEqual([]);
  });

  it('forwards taps on a shortcut while running, and stops on unsubscribe', () => {
    let listener: ((item: { id?: string }) => void) | null = null;
    const remove = vi.fn();
    setQuickActionsModuleForTests({
      ...fakeModule(),
      addListener(fn) {
        listener = fn;
        return { remove };
      },
    });
    const seen: string[] = [];
    const off = onQuickAction((id) => seen.push(id));

    listener!({ id: 'waves.shortcut.voice' });
    listener!({});
    expect(seen).toEqual(['waves.shortcut.voice']);

    off();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('gives a no-op unsubscribe when the module cannot listen', () => {
    expect(onQuickAction(() => {})).toBeTypeOf('function');
    setQuickActionsModuleForTests(null);
    expect(() => onQuickAction(() => {})()).not.toThrow();
  });

  it('swallows a launcher that refuses shortcuts', async () => {
    setQuickActionsModuleForTests({
      setItems: () => Promise.reject(new Error('unsupported launcher')),
    });
    await expect(syncQuickActions(TITLES)).resolves.toBeUndefined();
    await expect(clearQuickActions()).resolves.toBeUndefined();
  });

  it('loads the real module lazily, preferring its default export', async () => {
    const real = fakeModule('waves.shortcut.add');
    const path = stubRequire('expo-quick-actions', { default: real });
    try {
      setQuickActionsModuleForTests(undefined as never);
      await syncQuickActions(TITLES);
      expect(real.published).toHaveLength(1);
      expect(takeInitialQuickAction()).toBe('waves.shortcut.add');
    } finally {
      delete nodeRequire.cache[path];
    }
  });

  it('treats a module that will not load as absent', async () => {
    const path = nodeRequire.resolve('expo-quick-actions');
    Object.defineProperty(nodeRequire.cache, path, {
      configurable: true,
      get() {
        throw new Error('native module missing');
      },
    });
    try {
      setQuickActionsModuleForTests(undefined as never);
      await expect(syncQuickActions(TITLES)).resolves.toBeUndefined();
      expect(takeInitialQuickAction()).toBeNull();
    } finally {
      delete nodeRequire.cache[path];
    }
  });

  it('stays quiet on a build whose binary has no quick-actions module', async () => {
    setQuickActionsModuleForTests(null);
    await expect(syncQuickActions(TITLES)).resolves.toBeUndefined();
    await expect(clearQuickActions()).resolves.toBeUndefined();
    expect(takeInitialQuickAction()).toBeNull();
  });
});
