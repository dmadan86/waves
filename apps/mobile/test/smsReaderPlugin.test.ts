/**
 * The build-time half of the SMS gate.
 *
 * This is a compliance test, not a preference. `READ_SMS` is a restricted
 * permission: held in a Play artefact without an approved core use case, the
 * consequence is removal, and Play decides by scanning the merged manifest, not
 * by watching what the app does at runtime. So the property that has to hold is
 * blunt — *a default build's manifest must be exactly what it is today* — and
 * the way this plugin achieves it is blunt too: with the switch off it
 * registers no mod at all, so there is nothing that could produce a diff.
 *
 * The reference-equality assertion below is the whole point. A plugin that
 * returned a copied config, or registered a mod that happened to make no
 * change, would pass a weaker test and still be one refactor away from writing
 * the permission into a store build.
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withSmsReader = require('../plugins/withSmsReader.js') as ((config: unknown) => unknown) & {
  _internals: {
    PERMISSION: string;
    readerEnabled: (env: Record<string, string | undefined>) => boolean;
    manifestWithReadSms: (manifest: unknown) => { manifest: { 'uses-permission': unknown[] } };
  };
};

const { PERMISSION, readerEnabled, manifestWithReadSms } = withSmsReader._internals;

/** A manifest shaped the way `withAndroidManifest` hands one over. */
const manifestWith = (...permissions: string[]) => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    'uses-permission': permissions.map((name) => ({ $: { 'android:name': name } })),
    application: [{ $: { 'android:name': '.MainApplication' } }],
  },
});

const names = (result: { manifest: { 'uses-permission': unknown[] } }): string[] =>
  result.manifest['uses-permission'].map(
    (entry) => (entry as { $: Record<string, string> }).$['android:name'],
  );

describe('the switch', () => {
  it('is on for exactly one spelling', () => {
    expect(readerEnabled({ WAVES_SMS_READER: '1' })).toBe(true);
  });

  it('is off for everything else, including the plausible ones', () => {
    for (const value of [undefined, '', '0', 'true', 'TRUE', 'yes', 'on', ' 1']) {
      expect(readerEnabled({ WAVES_SMS_READER: value })).toBe(false);
    }
    expect(readerEnabled({})).toBe(false);
  });
});

describe('a default build', () => {
  it('gets the config back untouched — the same object, with no mod added', () => {
    delete process.env.WAVES_SMS_READER;
    const config = { name: 'Waves', android: { permissions: [] as string[] } };
    // Identity, deliberately. Anything else — a copy, or a registered mod that
    // makes no change — would still be a build whose manifest this plugin has
    // had its hands on, and the promise is that it has not.
    expect(withSmsReader(config)).toBe(config);
    expect(config).not.toHaveProperty('mods');
  });

  it('leaves android.permissions alone', () => {
    delete process.env.WAVES_SMS_READER;
    const config = { android: { permissions: ['android.permission.CAMERA'] } };
    withSmsReader(config);
    expect(config.android.permissions).toEqual(['android.permission.CAMERA']);
  });

  it('is off for a value that only looks like the switch', () => {
    process.env.WAVES_SMS_READER = 'true';
    const config = { name: 'Waves' };
    expect(withSmsReader(config)).toBe(config);
    delete process.env.WAVES_SMS_READER;
  });
});

describe('a build that asked for the reader', () => {
  it('registers an android manifest mod', () => {
    process.env.WAVES_SMS_READER = '1';
    const patched = withSmsReader({ name: 'Waves' }) as {
      mods?: { android?: { manifest?: unknown } };
    };
    expect(typeof patched.mods?.android?.manifest).toBe('function');
    delete process.env.WAVES_SMS_READER;
  });

  it('adds READ_SMS and nothing else', () => {
    const before = manifestWith('android.permission.INTERNET');
    const after = manifestWithReadSms(before);
    expect(names(after)).toEqual(['android.permission.INTERNET', PERMISSION]);
    expect(PERMISSION).toBe('android.permission.READ_SMS');
  });

  it('adds it to a manifest that declares nothing', () => {
    expect(names(manifestWithReadSms(manifestWith()))).toEqual([PERMISSION]);
  });

  it('is idempotent — prebuild can run twice over the same tree', () => {
    const once = manifestWithReadSms(manifestWith('android.permission.INTERNET'));
    const twice = manifestWithReadSms(once);
    expect(twice).toBe(once);
    expect(names(twice)).toHaveLength(2);
  });

  it('does not mutate the manifest it was given', () => {
    const before = manifestWith('android.permission.INTERNET');
    manifestWithReadSms(before);
    expect(names(before)).toEqual(['android.permission.INTERNET']);
  });

  it('fails loudly rather than silently on a manifest it does not recognise', () => {
    // A silent no-op here is the failure that matters in the *other* direction:
    // a build that asked for the reader and quietly did not get the permission
    // would show a system prompt that can never be granted.
    expect(() => manifestWithReadSms({})).toThrow(/READ_SMS/);
  });
});
