/**
 * The document scanner's three outcomes, and the launch-safety check in front
 * of it. `require` is not intercepted by `vi.mock`, so the plugin is stubbed in
 * Node's require cache.
 */

import { createRequire } from 'node:module';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: { OS: 'ios' as string },
  get: vi.fn<(name: string) => unknown>(),
}));

vi.mock('react-native', () => ({
  Platform: native.platform,
  TurboModuleRegistry: { get: native.get },
}));

const nodeRequire = createRequire(import.meta.url);
const pluginPath = nodeRequire.resolve('react-native-document-scanner-plugin');
const scan = vi.fn();
const original = nodeRequire.cache[pluginPath];

function stubPlugin(exports: unknown): void {
  nodeRequire.cache[pluginPath] = {
    id: pluginPath,
    filename: pluginPath,
    loaded: true,
    exports,
  } as never;
}

afterAll(() => {
  if (original) nodeRequire.cache[pluginPath] = original;
  else delete nodeRequire.cache[pluginPath];
});

const { scanDocument, scannerAvailable } = await import('../src/lib/scanner');

beforeEach(() => {
  native.platform.OS = 'ios';
  native.get.mockReset().mockReturnValue({});
  scan.mockReset();
  stubPlugin({ default: { scanDocument: scan } });
});

describe('whether the build has a scanner', () => {
  it('is present on a native binary that registered the module', () => {
    expect(scannerAvailable()).toBe(true);
    expect(native.get).toHaveBeenCalledWith('DocumentScanner');
  });

  it('is absent on web without asking the registry', () => {
    native.platform.OS = 'web';
    expect(scannerAvailable()).toBe(false);
    expect(native.get).not.toHaveBeenCalled();
  });

  it('is absent on an older binary, or when the registry throws', () => {
    native.get.mockReturnValue(null);
    expect(scannerAvailable()).toBe(false);
    native.get.mockImplementation(() => {
      throw new Error('no turbo modules');
    });
    expect(scannerAvailable()).toBe(false);
  });
});

describe('scanning a receipt', () => {
  it('hands back the one flattened page, asking for full quality', async () => {
    scan.mockResolvedValue({ scannedImages: ['file:///scan.jpg'] });

    await expect(scanDocument()).resolves.toEqual({ kind: 'image', uri: 'file:///scan.jpg' });
    expect(scan).toHaveBeenCalledWith({ maxNumDocuments: 1, croppedImageQuality: 100 });
  });

  it('calls backing out a cancel, not a reason to open another camera', async () => {
    scan.mockResolvedValue({ status: 'cancel' });
    await expect(scanDocument()).resolves.toEqual({ kind: 'cancelled' });
    scan.mockResolvedValue({ scannedImages: [] });
    await expect(scanDocument()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('reports unavailable when there is no scanner, so the camera takes over', async () => {
    native.get.mockReturnValue(null);
    await expect(scanDocument()).resolves.toEqual({ kind: 'unavailable' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('reports unavailable when the scanner will not open', async () => {
    scan.mockRejectedValue(new Error('activity not found'));
    await expect(scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('reports unavailable when the plugin itself cannot be loaded', async () => {
    Object.defineProperty(nodeRequire.cache[pluginPath]!, 'exports', {
      get() {
        throw new Error('getEnforcing: DocumentScanner');
      },
    });
    await expect(scanDocument()).resolves.toEqual({ kind: 'unavailable' });
  });
});
