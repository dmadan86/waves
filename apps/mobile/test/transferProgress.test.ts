import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  endTransfer,
  getTransferSnapshot,
  setTransferProgress,
  startTransfer,
  subscribeTransfers,
  useTransferProgress,
} from '../src/lib/transferProgress';
import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());

afterEach(() => {
  for (const id of ['a', 'b', 'c']) endTransfer(id);
});

describe('the app-wide transfer bar', () => {
  it('is idle when nothing is in flight', () => {
    expect(getTransferSnapshot()).toEqual({ active: false, fraction: 0 });
  });

  it('aggregates every transfer in flight into one fraction', () => {
    startTransfer('a', 4);
    startTransfer('b', 4);
    setTransferProgress('a', 3);
    setTransferProgress('b', 1);

    expect(getTransferSnapshot()).toEqual({ active: true, fraction: 0.5 });
  });

  it('clamps progress to the transfer and ignores unknown ids', () => {
    startTransfer('a', 4);
    setTransferProgress('a', -2);
    expect(getTransferSnapshot().fraction).toBe(0);

    setTransferProgress('nope', 3);
    expect(getTransferSnapshot()).toEqual({ active: true, fraction: 0 });

    setTransferProgress('a', 99);
    // All steps done: nothing is unfinished, so the bar goes idle.
    expect(getTransferSnapshot()).toEqual({ active: false, fraction: 0 });
  });

  it('keeps one stable snapshot between changes', () => {
    startTransfer('a', 2);
    expect(getTransferSnapshot()).toBe(getTransferSnapshot());
  });

  it('restarts a re-run under the same id from zero', () => {
    startTransfer('a', 2);
    setTransferProgress('a', 1);
    startTransfer('a', 4);
    expect(getTransferSnapshot().fraction).toBe(0);
  });

  it('treats a zero-step transfer as nothing to show', () => {
    startTransfer('c', -5);
    expect(getTransferSnapshot()).toEqual({ active: false, fraction: 0 });
  });

  it('tells subscribers about changes until they unsubscribe, and only on real ends', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTransfers(listener);

    startTransfer('a', 2);
    setTransferProgress('a', 1);
    endTransfer('a');
    endTransfer('a'); // already gone — no second notification
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    startTransfer('b', 1);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('re-renders the hook as transfers move', () => {
    const view = renderHook(() => useTransferProgress());
    expect(view.result.current.active).toBe(false);

    startTransfer('a', 4);
    setTransferProgress('a', 1);
    expect(view.result.current).toEqual({ active: true, fraction: 0.25 });

    endTransfer('a');
    expect(view.result.current.active).toBe(false);
    view.unmount();
  });
});
