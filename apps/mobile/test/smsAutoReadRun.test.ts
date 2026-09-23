/**
 * One automatic pass: the window it asks for, and when the clock moves.
 *
 * `lastCheckedAt` is the claim "everything up to here is on the Bank messages
 * screen", so it moves only when a read actually succeeded.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  gatesOpen: true,
  scan: vi.fn(
    async (_input: unknown) => ({ ok: true, added: 3 }) as { ok: boolean; added: number },
  ),
}));

vi.mock('@/lib/smsScan', () => ({
  deviceGatesOpen: async () => h.gatesOpen,
  runScan: h.scan,
}));

const { runAutoReadFor, deviceGatesOpen } = await import('@/lib/smsAutoReadRun');
const { loadLastCheckedAt, saveLastCheckedAt } = await import('@/lib/smsAutoReadStore');

const NOW = '2026-03-10T09:00:00.000Z';

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  await AsyncStorage.clear();
  h.gatesOpen = true;
  h.scan.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runAutoReadFor', () => {
  it('re-exports the device gate the scan uses', async () => {
    h.gatesOpen = false;
    expect(await deviceGatesOpen()).toBe(false);
  });

  it('does nothing without an account or with a shut gate', async () => {
    expect(await runAutoReadFor('')).toEqual({
      read: false,
      backfill: false,
      written: 0,
      checkedAt: null,
    });
    h.gatesOpen = false;
    expect((await runAutoReadFor('alice')).read).toBe(false);
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('backfills ninety days the first time, with the larger cap, and starts the clock', async () => {
    const outcome = await runAutoReadFor('alice');

    expect(outcome).toEqual({ read: true, backfill: true, written: 3, checkedAt: NOW });
    expect(h.scan).toHaveBeenCalledWith({
      ownerId: 'alice',
      window: { from: '2025-12-10', to: '2026-03-10' },
      maxCount: 1000,
    });
    expect(await loadLastCheckedAt('alice')).toBe(NOW);
  });

  it('reads only what is new afterwards, with the smaller cap', async () => {
    await saveLastCheckedAt('alice', '2026-03-09T09:00:00.000Z');

    const outcome = await runAutoReadFor('alice');

    expect(outcome.backfill).toBe(false);
    expect(h.scan).toHaveBeenCalledWith(expect.objectContaining({ maxCount: 200 }));
  });

  it('leaves the clock where it was when the inbox could not be read', async () => {
    await saveLastCheckedAt('alice', '2026-03-09T09:00:00.000Z');
    h.scan.mockResolvedValueOnce({ ok: false, added: 0 });

    const outcome = await runAutoReadFor('alice');

    expect(outcome).toEqual({ read: false, backfill: false, written: 0, checkedAt: null });
    expect(await loadLastCheckedAt('alice')).toBe('2026-03-09T09:00:00.000Z');
  });

  it('never throws, even when the scan does', async () => {
    h.scan.mockRejectedValueOnce(new Error('parser exploded'));

    await expect(runAutoReadFor('alice')).resolves.toEqual({
      read: false,
      backfill: false,
      written: 0,
      checkedAt: null,
    });
    expect(await loadLastCheckedAt('alice')).toBeNull();
  });
});
