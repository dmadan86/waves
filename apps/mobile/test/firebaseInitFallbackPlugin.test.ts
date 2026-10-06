/**
 * The Firebase start-up fallback lands in MainApplication.onCreate, once, right
 * after `super.onCreate()`, and refuses a template it cannot anchor on.
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../plugins/withFirebaseInitFallback.js') as {
  _internals: { MARKER: string; withFallback: (contents: string) => string };
};

const { MARKER, withFallback } = plugin._internals;

const mainApplication = `class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = ReleaseLevel.STABLE
    loadReactNative(this)
  }
}
`;

describe('withFirebaseInitFallback', () => {
  it('inserts the fallback straight after super.onCreate()', () => {
    const out = withFallback(mainApplication);
    const superAt = out.indexOf('super.onCreate()');
    const blockAt = out.indexOf(MARKER);
    const nextLineAt = out.indexOf('DefaultNewArchitectureEntryPoint');
    expect(blockAt).toBeGreaterThan(superAt);
    expect(blockAt).toBeLessThan(nextLineAt);
    expect(out).toContain('"getApps"');
    expect(out).toContain('"initializeApp"');
  });

  it('only initializes when no Firebase app exists, and never throws', () => {
    const out = withFallback(mainApplication);
    expect(out).toMatch(/if \(apps\.isEmpty\(\)\)/);
    expect(out).toMatch(/catch \(e: Throwable\)/);
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = withFallback(mainApplication);
    expect(withFallback(once)).toBe(once);
    expect(once.split(`begin ${MARKER}`).length - 1).toBe(1);
  });

  it('fails loudly when the template has no super.onCreate() to anchor on', () => {
    expect(() => withFallback('class MainApplication : Application()\n')).toThrow(
      /super\.onCreate/,
    );
  });

  it('also starts ML Kit, whose provider is skipped on the same phones', () => {
    const out = withFallback(
      'class A {\n  override fun onCreate() {\n    super.onCreate()\n  }\n}',
    );
    expect(out).toContain('com.google.mlkit.common.sdkinternal.MlKitContext');
    expect(out).toContain('initializeIfNeeded');
  });
});
