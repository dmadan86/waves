import { describe, expect, it } from 'vitest';
import {
  active,
  shouldNotify,
  transition,
  uploadPercent,
  type RunProgress,
} from '@/lib/backup/progress';

describe('backup progress', () => {
  it('uses uploaded bytes, caps before verification, and admits unknown lengths', () => {
    expect(uploadPercent(50, 100)).toBe(54);
    expect(uploadPercent(100, 100)).toBe(94);
    expect(uploadPercent(200, 100)).toBe(94);
    expect(uploadPercent(1, 0)).toBeNull();
  });
  it('throttles bytes but sends stage changes immediately', () => {
    const previous: RunProgress = { status: 'uploading', percent: 20 };
    expect(shouldNotify(previous, { ...previous, percent: 21 }, 999)).toBe(false);
    expect(shouldNotify(previous, { ...previous, percent: 21 }, 1000)).toBe(true);
    expect(shouldNotify(previous, { status: 'failed', percent: null }, 0)).toBe(true);
  });
  it('moves through preparation, upload, pause, retry, verification and completion', () => {
    let state: RunProgress = { status: 'failed', percent: null };
    for (const status of ['preparing', 'uploading', 'paused', 'uploading'] as const) {
      state = transition(state, { status, percent: null });
      expect(state.status).toBe(status);
      expect(active(state)).toBe(true);
    }
    expect(transition(state, { status: 'complete', percent: 95 })).toBe(state);
    state = transition(state, { status: 'complete', percent: 100 });
    expect(active(state)).toBe(false);
    expect(transition(state, { status: 'uploading', percent: 10 })).toBe(state);
    expect(transition(state, { status: 'preparing', percent: null }).status).toBe('preparing');
  });
  it.each(['cancelled', 'failed'] as const)('allows a safe retry after %s', (status) => {
    const stopped = transition({ status: 'uploading', percent: 40 }, { status, percent: null });
    expect(active(stopped)).toBe(false);
    expect(transition(stopped, { status: 'preparing', percent: null }).status).toBe('preparing');
  });
});

describe('bounded connectivity retry', () => {
  it('continues once connectivity permits, and stops on cancellation', async () => {
    const { waitForConnection } = await import('@/lib/backup/reconnect');
    await expect(
      waitForConnection(async () => true, new AbortController().signal),
    ).resolves.toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    await expect(waitForConnection(async () => false, controller.signal)).rejects.toThrow(
      'cancelled',
    );
    await expect(
      waitForConnection(async () => false, new AbortController().signal, 0),
    ).rejects.toThrow('unavailable');
  });
});
