/**
 * The soft-failing seam over expo-print: a PDF where the native module is
 * linked, `null` (the "update the app" message) where it is not — never a
 * crash at launch.
 */

import { createRequire } from 'node:module';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: { OS: 'android' as string } }));
vi.mock('react-native', () => ({ Platform: native.platform }));

const nodeRequire = createRequire(import.meta.url);
const printPath = nodeRequire.resolve('expo-print');
const original = nodeRequire.cache[printPath];
const printToFileAsync = vi.fn();

type Host = { expo?: { modules?: Record<string, unknown> } };
const host = globalThis as Host;
const savedExpo = host.expo;

afterAll(() => {
  if (original) nodeRequire.cache[printPath] = original;
  else delete nodeRequire.cache[printPath];
  host.expo = savedExpo;
});

beforeEach(() => {
  vi.resetModules();
  native.platform.OS = 'android';
  host.expo = { modules: { ExpoPrint: {} } };
  printToFileAsync.mockReset().mockResolvedValue({ uri: 'file:///cache/export.pdf' });
  nodeRequire.cache[printPath] = {
    id: printPath,
    filename: printPath,
    loaded: true,
    exports: { printToFileAsync },
  } as never;
});

const load = () => import('../src/lib/print');

describe('printing a group export to PDF', () => {
  it('renders the HTML to a file on a build that linked expo-print', async () => {
    const { printAvailable, printHtmlToFile } = await load();

    expect(printAvailable()).toBe(true);
    await expect(printHtmlToFile('<h1>Goa</h1>')).resolves.toBe('file:///cache/export.pdf');
    expect(printToFileAsync).toHaveBeenCalledWith({ html: '<h1>Goa</h1>' });
  });

  it('answers null on a stale binary without the native module', async () => {
    host.expo = { modules: {} };
    const { printAvailable, printHtmlToFile } = await load();

    expect(printAvailable()).toBe(false);
    await expect(printHtmlToFile('<p/>')).resolves.toBeNull();
    expect(printToFileAsync).not.toHaveBeenCalled();
  });

  it('answers null on web, where there is no print backend', async () => {
    native.platform.OS = 'web';
    const { printAvailable, printHtmlToFile } = await load();

    expect(printAvailable()).toBe(false);
    await expect(printHtmlToFile('<p/>')).resolves.toBeNull();
  });

  it('answers null when the wrapper throws while loading', async () => {
    Object.defineProperty(nodeRequire.cache[printPath]!, 'exports', {
      get() {
        throw new Error("Cannot find native module 'ExpoPrint'");
      },
    });
    const { printHtmlToFile } = await load();

    await expect(printHtmlToFile('<p/>')).resolves.toBeNull();
  });

  it('lets a genuine render failure through for the caller to explain', async () => {
    printToFileAsync.mockRejectedValue(new Error('WebView crashed'));
    const { printHtmlToFile } = await load();

    await expect(printHtmlToFile('<p/>')).rejects.toThrow('WebView crashed');
  });
});
