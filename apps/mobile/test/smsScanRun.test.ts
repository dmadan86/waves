/**
 * One scan of the inbox, end to end, with the device stubbed out.
 *
 * `smsScan.test.ts` covers the decisions a scan makes; this covers the wiring
 * that strings them together in `runScan`: what the device store already knows
 * is not re-sorted, what the account already has a capture for is not drafted
 * again, one draft that will not go down does not take the others with it, and
 * none of it ever throws — the callers are a screen, a foreground effect and a
 * headless WorkManager wake-up, and none of them can do anything with one.
 */

import { createRequire } from 'node:module';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifySms, type SmsMessage } from '@waves/core';

const h = vi.hoisted(() => ({
  read: vi.fn(),
  knownKeys: vi.fn(),
  saveMessages: vi.fn(),
  enqueue: vi.fn(),
  capturedKeys: [] as string[],
}));

// `deviceGateReason` reaches React Native through a runtime `require` (so an
// iPhone build never loads it at module scope). `vi.mock` only intercepts
// `import`, so the stub goes into Node's require cache instead.
const nodeRequire = createRequire(import.meta.url);
const reactNativePath = nodeRequire.resolve('react-native');
const reactNative = { Platform: { OS: 'android' } };
nodeRequire.cache[reactNativePath] = {
  id: reactNativePath,
  filename: reactNativePath,
  loaded: true,
  exports: reactNative,
} as never;

afterAll(() => {
  delete nodeRequire.cache[reactNativePath];
});

vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));

vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
vi.mock('@/lib/smsFeature', () => ({ smsReaderInBuild: () => true }));
vi.mock('@/lib/smsReader', () => ({
  SmsReadFailure: {
    Unsupported: 'unsupported',
    Unavailable: 'unavailable',
    Denied: 'denied',
    Blocked: 'blocked',
    Failed: 'failed',
  },
  readSmsGranted: h.read,
  smsPermissionGranted: async () => true,
}));
vi.mock('@/lib/smsMessageStore', () => ({
  knownKeys: h.knownKeys,
  saveMessages: h.saveMessages,
}));
vi.mock('@/lib/smsCaptureId', () => ({
  smsCaptureId: async (_owner: string, key: string) => `capture-${key}`,
}));
vi.mock('@/data/hooks', () => ({
  serialiseCapture: (input: Record<string, unknown>, captureId: string) => ({
    captureId,
    description: input.description,
  }),
}));
vi.mock('@/sync', () => ({
  syncEngine: {
    getState: () => ({ hydrated: true, mirror: {}, queue: [] }),
    hydrate: async () => {},
    enqueue: h.enqueue,
  },
}));
vi.mock('@waves/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@waves/core')>()),
  // What the account already has a capture for — the only part of the mirror
  // `runScan` reads.
  materialiseCaptures: () => h.capturedKeys.map((dedupeKey) => ({ parsed: { dedupeKey } })),
}));

const { runScan } = await import('@/lib/smsScan');

const sms = (body: string): SmsMessage => ({
  body,
  receivedAt: '2026-03-06T10:00:00.000Z',
  sender: 'AD-HDFCBK',
});

const KNOWN = sms(
  'Rs.1,250.00 debited from a/c XX4471 on 02-03-26 at SWIGGY. UPI Ref: 412703998812',
);
const CAPTURED = sms('Rs.240 debited at BLUE TOKAI on 03-03-26. Ref: 998877665544');
const FRESH_A = sms('Rs.600 debited from a/c XX4471 on 04-03-26 at ZOMATO. UPI Ref: 112233445566');
const FRESH_B = sms('Rs.900 debited from a/c XX4471 on 05-03-26 at UBER. UPI Ref: 665544332211');

const keyOf = (message: SmsMessage): string => {
  const sorted = classifySms([message]);
  const row = [...sorted.expenses, ...sorted.income, ...sorted.other][0];
  if (!row) throw new Error(`fixture did not classify: ${message.body}`);
  return row.dedupeKey;
};

const WINDOW = { from: '2026-03-01', to: '2026-03-10' };

beforeEach(() => {
  reactNative.Platform.OS = 'android';
  h.read.mockReset();
  h.knownKeys.mockReset().mockResolvedValue([]);
  h.saveMessages.mockReset().mockImplementation(async (_owner, rows: unknown[]) => rows.length);
  h.enqueue.mockReset().mockResolvedValue(undefined);
  h.capturedKeys = [];
});

describe('runScan', () => {
  it('skips what is known and captured, survives a failed draft, and counts it all', async () => {
    // Given four messages: one the device store already holds, one this account
    // already has a capture for, and two new — the first of whose drafts fails.
    h.read.mockResolvedValue({ ok: true, messages: [KNOWN, CAPTURED, FRESH_A, FRESH_B] });
    h.knownKeys.mockResolvedValue([keyOf(KNOWN)]);
    h.capturedKeys = [keyOf(CAPTURED)];
    h.enqueue.mockRejectedValueOnce(new Error('queue write failed'));
    const progress: string[] = [];

    // When the scan runs…
    const result = await runScan({
      ownerId: 'owner-1',
      window: WINDOW,
      maxCount: 50,
      onProgress: (step) => progress.push(step.stage),
    });

    // …then it finishes cleanly, with honest counts.
    expect(result.ok).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.scanned).toBe(4);
    // The known message is never re-sorted or re-saved.
    expect(result.added).toBe(3);
    expect(h.saveMessages).toHaveBeenCalledWith('owner-1', expect.any(Array));
    expect((h.saveMessages.mock.calls[0]![1] as unknown[]).length).toBe(3);
    expect(result.expenses).toBe(3);
    expect(result.income).toBe(0);
    // Two drafts were attempted (the captured one never was), one went down.
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(result.drafted).toBe(1);
    expect(result.finishedAt).not.toBeNull();
    expect(progress[0]).toBe('reading');
    expect(progress).toContain('sorting');
    expect(progress.at(-1)).toBe('saving');
  });

  it('reports why when the inbox cannot be read, without throwing', async () => {
    h.read.mockResolvedValue({ ok: false, reason: 'denied' });

    const result = await runScan({ ownerId: 'owner-1', window: WINDOW, maxCount: 50 });

    expect(result).toMatchObject({ ok: false, failure: 'denied', scanned: 0, drafted: 0 });
    expect(h.saveMessages).not.toHaveBeenCalled();
  });

  it('declines off Android before asking for anything', async () => {
    reactNative.Platform.OS = 'ios';

    const result = await runScan({ ownerId: 'owner-1', window: WINDOW, maxCount: 50 });

    expect(result).toMatchObject({ ok: false, failure: 'unsupported' });
    expect(h.read).not.toHaveBeenCalled();
  });

  it('turns a store failure into a plain not-ok result rather than an exception', async () => {
    h.read.mockResolvedValue({ ok: true, messages: [FRESH_A] });
    h.saveMessages.mockRejectedValue(new Error('SQLITE_FULL'));

    const result = await runScan({ ownerId: 'owner-1', window: WINDOW, maxCount: 50 });

    expect(result.ok).toBe(false);
    expect(result.finishedAt).toBeNull();
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing at all without an owner', async () => {
    const result = await runScan({ ownerId: '', window: WINDOW, maxCount: 50 });

    expect(result.ok).toBe(false);
    expect(h.read).not.toHaveBeenCalled();
  });
});
