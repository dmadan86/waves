/**
 * The app-icon long-press menu.
 *
 * Waves publishes no entries there any more; all that is left is clearing the
 * ones older versions published, so a phone upgrading from one of them stops
 * showing Add / Scan / Voice. These tests pin that the clear happens, that it
 * never publishes anything, and that it stays quiet wherever the native module
 * is missing or the launcher refuses.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearQuickActions, setQuickActionsModuleForTests } from '../src/lib/quickActions';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// The real module is reached by `require`, which `vi.mock` does not intercept.
const nodeRequire = createRequire(import.meta.url);
function stubRequire(specifier: string, exports: unknown): string {
  const path = nodeRequire.resolve(specifier);
  nodeRequire.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
  return path;
}

/** A stand-in for `expo-quick-actions` that records every `setItems`. */
function fakeModule() {
  return {
    published: [] as unknown[][],
    setItems(items: unknown[]) {
      this.published.push(items);
    },
  };
}

let quickActions: ReturnType<typeof fakeModule>;

beforeEach(() => {
  quickActions = fakeModule();
  setQuickActionsModuleForTests(quickActions);
});

describe('app-icon quick shortcuts', () => {
  it('clears the menu, publishing nothing in its place', async () => {
    await clearQuickActions();
    expect(quickActions.published).toEqual([[]]);
  });

  it('swallows a launcher that refuses shortcuts', async () => {
    setQuickActionsModuleForTests({
      setItems: () => Promise.reject(new Error('unsupported launcher')),
    });
    await expect(clearQuickActions()).resolves.toBeUndefined();
  });

  it('loads the real module lazily, preferring its default export', async () => {
    const real = fakeModule();
    const path = stubRequire('expo-quick-actions', { default: real });
    try {
      setQuickActionsModuleForTests(undefined);
      await clearQuickActions();
      expect(real.published).toEqual([[]]);
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
      setQuickActionsModuleForTests(undefined);
      await expect(clearQuickActions()).resolves.toBeUndefined();
    } finally {
      delete nodeRequire.cache[path];
    }
  });

  it('stays quiet on a build whose binary has no quick-actions module', async () => {
    setQuickActionsModuleForTests(null);
    await expect(clearQuickActions()).resolves.toBeUndefined();
  });

  it('the app mounts only the clearing half — nothing publishes or routes shortcuts', () => {
    const root = join(__dirname, '..');
    const component = readFileSync(join(root, 'src/components/QuickShortcuts.tsx'), 'utf8');
    const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
    expect(component).toContain('clearQuickActions()');
    expect(component).not.toContain('syncQuickActions');
    expect(layout).not.toContain('QuickShortcutRouting');
    // The long-press menu's icon plugin is gone with the menu.
    const appJson = readFileSync(join(root, 'app.json'), 'utf8');
    expect(appJson).not.toContain('withShortcutIcons');
  });
});
