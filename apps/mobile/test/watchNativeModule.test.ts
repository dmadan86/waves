/**
 * The phone's handle on the native watch transport, when a build has one.
 *
 * Every call must be a safe no-op without the module (older builds, web) and
 * must never throw into the app when the native side misbehaves — a watch is an
 * accessory, and the phone app cannot depend on it being there. The send-failure
 * path has its own suite (`watchSendFailure.test.ts`); this covers reachability
 * and the watch→phone subscription.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({ native: null as Record<string, unknown> | null }));

vi.mock('expo', () => ({ requireOptionalNativeModule: () => stub.native }));

async function load(native: Record<string, unknown> | null) {
  stub.native = native;
  vi.resetModules();
  return import('@/lib/watch/nativeModule');
}

// Pay the cold transform of `@waves/core` once, outside any test's budget.
beforeAll(async () => {
  await import('@/lib/watch/nativeModule');
}, 60_000);

beforeEach(() => {
  stub.native = null;
});

describe('watchReachable', () => {
  it('is false with no transport', async () => {
    const m = await load(null);
    expect(m.watchAvailable()).toBe(false);
    expect(m.watchReachable()).toBe(false);
  });

  it('asks the transport', async () => {
    let reachable = true;
    const m = await load({ isReachable: () => reachable });
    expect(m.watchAvailable()).toBe(true);
    expect(m.watchReachable()).toBe(true);
    reachable = false;
    expect(m.watchReachable()).toBe(false);
  });

  it('is false when the transport throws', async () => {
    const m = await load({
      isReachable: () => {
        throw new Error('session inactive');
      },
    });
    expect(m.watchReachable()).toBe(false);
  });
});

describe('sendToWatch', () => {
  it('is false with no transport', async () => {
    const m = await load(null);
    expect(m.sendToWatch({ t: 'ack', ok: true })).toBe(false);
  });

  it('encodes the message with the relay version and reports it dispatched', async () => {
    const sendToWatch = vi.fn();
    const m = await load({ sendToWatch });
    expect(m.sendToWatch({ t: 'ack', ok: true })).toBe(true);
    expect(sendToWatch).toHaveBeenCalledWith(
      expect.objectContaining({ t: 'ack', ok: true, version: 1 }),
    );
  });

  it('is false when the native call throws synchronously', async () => {
    const m = await load({
      sendToWatch: () => {
        throw new Error('gone');
      },
    });
    expect(m.sendToWatch({ t: 'ack', ok: true })).toBe(false);
  });
});

describe('onWatchMessage', () => {
  it('is a no-op subscription with no transport', async () => {
    const m = await load(null);
    const unsubscribe = m.onWatchMessage(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('hands the raw payload of each event to the handler, and unsubscribes', async () => {
    let listener: ((event: { payload: unknown }) => void) | null = null;
    const remove = vi.fn();
    const m = await load({
      addListener: (event: string, handler: (event: { payload: unknown }) => void) => {
        if (event === 'onWatchMessage') listener = handler;
        return { remove };
      },
    });
    const seen: unknown[] = [];
    const unsubscribe = m.onWatchMessage((raw) => seen.push(raw));
    listener!({ payload: { t: 'requestRecent' } });
    expect(seen).toEqual([{ t: 'requestRecent' }]);
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('survives a module torn down before the unsubscribe', async () => {
    const m = await load({
      addListener: () => ({
        remove: () => {
          throw new Error('already gone');
        },
      }),
    });
    const unsubscribe = m.onWatchMessage(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('behaves as if there were no transport when subscribing fails', async () => {
    const m = await load({
      addListener: () => {
        throw new Error('no such event');
      },
    });
    const unsubscribe = m.onWatchMessage(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });
});
