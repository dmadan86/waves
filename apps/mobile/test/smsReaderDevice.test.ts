/**
 * The device wiring around the inbox reader never throws.
 *
 * `smsReader.test.ts` drives `readSmsInbox` with injected dependencies. This
 * drives the real entry points — `readSms` (asks for the permission) and
 * `readSmsGranted` (only checks it) — which reach React Native and the optional
 * `react-native-get-sms-android` module through runtime `require`s. A build
 * without the module, or a person who says no, must come back as
 * `{ ok: false, reason }`: an exception here is a crash at the exact moment
 * somebody tapped a button asking for their bank messages.
 *
 * `vi.mock` only intercepts `import`, so both native modules are stubbed in
 * Node's require cache instead.
 */

import { createRequire } from 'node:module';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ noteGranted: vi.fn() }));

vi.mock('@/lib/smsAutoReadStore', () => ({ noteSmsPermissionGranted: h.noteGranted }));

const nodeRequire = createRequire(import.meta.url);

/** Put `exports` where a `require(specifier)` from the app will find it. */
function stubRequire(specifier: string, exports: unknown): string {
  const path = nodeRequire.resolve(specifier);
  nodeRequire.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
  return path;
}

const RESULTS = { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' };
const reactNative = {
  Platform: { OS: 'android' },
  PermissionsAndroid: {
    PERMISSIONS: { READ_SMS: 'android.permission.READ_SMS' },
    RESULTS,
    request: vi.fn(),
    check: vi.fn(),
  },
};
const stubbed = [
  stubRequire('react-native', reactNative),
  stubRequire('react-native-get-sms-android', null),
];
const smsModulePath = stubbed[1]!;

afterAll(() => {
  for (const path of stubbed) delete nodeRequire.cache[path];
});

const { readSms, readSmsGranted, smsPermissionGranted, SmsReadFailure } =
  await import('@/lib/smsReader');

const WINDOW = { from: '2026-07-01', to: '2026-07-08' };
const RATIONALE = {
  title: 'Read bank SMS',
  message: 'To find expenses',
  allow: 'OK',
  notNow: 'No',
};

/** Swap the optional native module. `null` is a build that never bundled it. */
function installModule(exports: unknown): void {
  nodeRequire.cache[smsModulePath]!.exports = exports;
}

const workingModule = {
  list: (
    _filter: string,
    _fail: (error: string) => void,
    success: (count: number, json: string) => void,
  ) => success(1, JSON.stringify([{ body: 'Rs 500 debited', date: 1_751_356_800_000 }])),
};

beforeEach(() => {
  reactNative.Platform.OS = 'android';
  reactNative.PermissionsAndroid.request.mockReset().mockResolvedValue(RESULTS.GRANTED);
  reactNative.PermissionsAndroid.check.mockReset().mockResolvedValue(true);
  h.noteGranted.mockReset();
  installModule(workingModule);
});

describe('readSms', () => {
  it('is unavailable — not a crash — when the native module is missing from the build', async () => {
    installModule(null);

    const result = await readSms(WINDOW, RATIONALE);

    expect(result).toEqual({ ok: false, reason: SmsReadFailure.Unavailable });
    // Nobody is asked for a permission the build could never use.
    expect(reactNative.PermissionsAndroid.request).not.toHaveBeenCalled();
    expect(h.noteGranted).not.toHaveBeenCalled();
  });

  it('reports a denial', async () => {
    reactNative.PermissionsAndroid.request.mockResolvedValue(RESULTS.DENIED);

    await expect(readSms(WINDOW, RATIONALE)).resolves.toEqual({
      ok: false,
      reason: SmsReadFailure.Denied,
    });
    expect(h.noteGranted).not.toHaveBeenCalled();
  });

  it('reports never-ask-again as blocked', async () => {
    reactNative.PermissionsAndroid.request.mockResolvedValue(RESULTS.NEVER_ASK_AGAIN);

    await expect(readSms(WINDOW, RATIONALE)).resolves.toEqual({
      ok: false,
      reason: SmsReadFailure.Blocked,
    });
  });

  it('treats a permission request that throws as a denial', async () => {
    reactNative.PermissionsAndroid.request.mockRejectedValue(new Error('activity gone'));

    await expect(readSms(WINDOW, RATIONALE)).resolves.toEqual({
      ok: false,
      reason: SmsReadFailure.Denied,
    });
  });

  it('shows the rationale in the app’s own words', async () => {
    await readSms(WINDOW, RATIONALE);

    expect(reactNative.PermissionsAndroid.request).toHaveBeenCalledWith(
      'android.permission.READ_SMS',
      {
        title: 'Read bank SMS',
        message: 'To find expenses',
        buttonPositive: 'OK',
        buttonNegative: 'No',
      },
    );
  });

  it('reads, and notes the grant, when allowed', async () => {
    const result = await readSms(WINDOW, RATIONALE);

    expect(result.ok).toBe(true);
    expect(result.ok && result.messages.map((message) => message.body)).toEqual(['Rs 500 debited']);
    expect(h.noteGranted).toHaveBeenCalledTimes(1);
  });

  it('is unsupported off Android', async () => {
    reactNative.Platform.OS = 'ios';

    await expect(readSms(WINDOW, RATIONALE)).resolves.toEqual({
      ok: false,
      reason: SmsReadFailure.Unsupported,
    });
  });
});

describe('readSmsGranted', () => {
  it('reports Denied without ever raising a dialog when the permission is not held', async () => {
    reactNative.PermissionsAndroid.check.mockResolvedValue(false);

    await expect(readSmsGranted(WINDOW)).resolves.toEqual({
      ok: false,
      reason: SmsReadFailure.Denied,
    });
    expect(reactNative.PermissionsAndroid.request).not.toHaveBeenCalled();
  });

  it('is unavailable when the module is missing', async () => {
    installModule(null);

    await expect(readSmsGranted(WINDOW)).resolves.toEqual({
      ok: false,
      reason: SmsReadFailure.Unavailable,
    });
  });
});

describe('smsPermissionGranted', () => {
  it('answers false, not an exception, when the check itself throws', async () => {
    reactNative.PermissionsAndroid.check.mockRejectedValue(new Error('no activity'));
    await expect(smsPermissionGranted()).resolves.toBe(false);
  });

  it('answers false off Android without asking', async () => {
    reactNative.Platform.OS = 'ios';
    await expect(smsPermissionGranted()).resolves.toBe(false);
    expect(reactNative.PermissionsAndroid.check).not.toHaveBeenCalled();
  });
});
