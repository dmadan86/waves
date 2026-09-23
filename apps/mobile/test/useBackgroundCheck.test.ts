/**
 * The "check in the background" switch: optimistic on first paint, settles to
 * the stored answer, and a flip both persists and moves the schedule at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackgroundCheck } from '../src/lib/useBackgroundCheck';
import { flush, renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

const h = vi.hoisted(() => ({
  backgroundCheckWanted: vi.fn(),
  saveBackgroundCheckWanted: vi.fn(),
  syncAutoReadSchedule: vi.fn(),
}));

vi.mock('../src/lib/smsAutoReadStore', () => ({
  backgroundCheckWanted: h.backgroundCheckWanted,
  saveBackgroundCheckWanted: h.saveBackgroundCheckWanted,
}));
vi.mock('../src/lib/smsAutoReadTask', () => ({ syncAutoReadSchedule: h.syncAutoReadSchedule }));

beforeEach(() => {
  vi.clearAllMocks();
  h.backgroundCheckWanted.mockResolvedValue(false);
  h.saveBackgroundCheckWanted.mockResolvedValue(undefined);
  h.syncAutoReadSchedule.mockResolvedValue(undefined);
});

describe('useBackgroundCheck', () => {
  it('starts on, then settles to the stored answer', async () => {
    const view = renderHook(() => useBackgroundCheck());
    expect(view.result.current.wanted).toBe(true);
    await flush();
    expect(view.result.current.wanted).toBe(false);
  });

  it('flips at once, saves, then moves the schedule to match', async () => {
    const view = renderHook(() => useBackgroundCheck());
    await flush();

    view.result.current.setWanted(true);
    expect(view.result.current.wanted).toBe(true);
    await flush();

    expect(h.saveBackgroundCheckWanted).toHaveBeenCalledWith(true);
    expect(h.syncAutoReadSchedule).toHaveBeenCalledWith(true);
    expect(h.saveBackgroundCheckWanted.mock.invocationCallOrder[0]).toBeLessThan(
      h.syncAutoReadSchedule.mock.invocationCallOrder[0]!,
    );
  });

  it('ignores a stored answer that lands after unmount', async () => {
    const view = renderHook(() => useBackgroundCheck());
    view.unmount();
    await flush();
    expect(view.result.current.wanted).toBe(true);
  });
});
