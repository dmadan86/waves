/**
 * The guarded gate to the speech recogniser's model surface: null wherever the
 * native module cannot be reached, and never a button offered that cannot work
 * (download only on Android 13+, "installed" only believed on Android).
 *
 * `expo-speech-recognition` is reached by `require`, so the stub lives in
 * Node's require cache rather than behind `vi.mock`.
 */

import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'android' as string, Version: 34 as number | string }));

vi.mock('react-native', () => ({ Platform: platform }));

const nodeRequire = createRequire(import.meta.url);
const modulePath = nodeRequire.resolve('expo-speech-recognition');

const native = {
  supportsOnDeviceRecognition: vi.fn(() => true),
  getDefaultRecognitionService: vi.fn(() => ({ packageName: 'com.google.android.tts' })),
  getSupportedLocales: vi.fn(),
  androidTriggerOfflineModelDownload: vi.fn(),
};

function stub(exports: unknown): void {
  nodeRequire.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  } as never;
}

async function load(os = 'android', version: number | string = 34) {
  platform.OS = os;
  platform.Version = version;
  vi.resetModules();
  return (await import('../src/lib/speechModels')).speechModels;
}

beforeEach(() => {
  vi.clearAllMocks();
  native.supportsOnDeviceRecognition.mockReturnValue(true);
  native.getDefaultRecognitionService.mockReturnValue({ packageName: 'com.google.android.tts' });
  native.getSupportedLocales.mockResolvedValue({
    locales: ['en-US', 'ta-IN'],
    installedLocales: ['en-US'],
  });
  native.androidTriggerOfflineModelDownload.mockResolvedValue({
    status: 'download_success',
    message: '',
  });
  stub({ ExpoSpeechRecognitionModule: native });
});

afterEach(() => {
  delete nodeRequire.cache[modulePath];
});

describe('reaching the module', () => {
  it('is null on web without even trying', async () => {
    expect(await load('web')).toBeNull();
  });

  it('is null when the binary has no usable module', async () => {
    stub({ ExpoSpeechRecognitionModule: {} });
    expect(await load()).toBeNull();
    stub({});
    expect(await load()).toBeNull();
  });

  it('is null when requiring the module throws', async () => {
    Object.defineProperty(nodeRequire.cache, modulePath, {
      configurable: true,
      get() {
        throw new Error('Cannot find native module');
      },
    });
    expect(await load()).toBeNull();
  });
});

describe('on Android 14', () => {
  it('reports on-device support, trusts installed, and can download', async () => {
    const api = (await load('android', 34))!;
    expect(api.supportsOnDevice()).toBe(true);
    expect(api.reportsInstalled()).toBe(true);
    expect(api.canDownload()).toBe(true);
  });

  it('reads as no on-device support when the probe throws', async () => {
    native.supportsOnDeviceRecognition.mockImplementation(() => {
      throw new Error('no service');
    });
    expect((await load())!.supportsOnDevice()).toBe(false);
  });

  it('asks the same recogniser the mic asks, by package', async () => {
    const api = (await load())!;
    await expect(api.listLocales()).resolves.toEqual({
      locales: ['en-US', 'ta-IN'],
      installedLocales: ['en-US'],
    });
    expect(native.getSupportedLocales).toHaveBeenCalledWith({
      androidRecognitionServicePackage: 'com.google.android.tts',
    });
  });

  it('queries bare when there is no service to name, and fills missing lists', async () => {
    native.getDefaultRecognitionService.mockImplementation(() => {
      throw new Error('none');
    });
    native.getSupportedLocales.mockResolvedValue({});
    const api = (await load())!;
    await expect(api.listLocales()).resolves.toEqual({ locales: [], installedLocales: [] });
    expect(native.getSupportedLocales).toHaveBeenCalledWith({});
  });

  it('passes the download status straight back', async () => {
    native.androidTriggerOfflineModelDownload.mockResolvedValue({
      status: 'download_scheduled',
      message: 'wifi',
    });
    const api = (await load())!;
    await expect(api.download('ta-IN')).resolves.toBe('download_scheduled');
    expect(native.androidTriggerOfflineModelDownload).toHaveBeenCalledWith({ locale: 'ta-IN' });
  });
});

describe('elsewhere', () => {
  it('offers no download below Android 13', async () => {
    expect((await load('android', 32))!.canDownload()).toBe(false);
  });

  it('on iOS: no download, installed is an echo, and an empty package means a bare query', async () => {
    native.getDefaultRecognitionService.mockReturnValue({ packageName: '' });
    const api = (await load('ios', '18.0'))!;
    expect(api.canDownload()).toBe(false);
    expect(api.reportsInstalled()).toBe(false);
    await api.listLocales();
    expect(native.getSupportedLocales).toHaveBeenCalledWith({});
  });
});
