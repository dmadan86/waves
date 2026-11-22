import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUndoScheduler } from '../src/lib/undoScheduler';

afterEach(() => vi.useRealTimers());

describe('undo scheduler', () => {
  it('defers a commit until its timer expires', () => {
    vi.useFakeTimers();
    const scheduler = createUndoScheduler();
    const commit = vi.fn();
    scheduler.schedule('one', commit, 5000);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledOnce();
    expect(scheduler.has('one')).toBe(false);
  });

  it('replaces a pending action on the same key', () => {
    vi.useFakeTimers();
    const scheduler = createUndoScheduler();
    const first = vi.fn();
    const second = vi.fn();
    scheduler.schedule('same', first, 5000);
    vi.advanceTimersByTime(3000);
    scheduler.schedule('same', second, 5000);
    vi.advanceTimersByTime(5000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('cancels a pending action', () => {
    vi.useFakeTimers();
    const scheduler = createUndoScheduler();
    const commit = vi.fn();
    scheduler.schedule('one', commit, 5000);
    expect(scheduler.cancel('one')).toBe(true);
    expect(scheduler.cancel('one')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(commit).not.toHaveBeenCalled();
  });

  it('flushes every pending action immediately', () => {
    vi.useFakeTimers();
    const scheduler = createUndoScheduler();
    const first = vi.fn();
    const second = vi.fn();
    scheduler.schedule('one', first, 5000);
    scheduler.schedule('two', second, 5000);
    scheduler.flush();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});
