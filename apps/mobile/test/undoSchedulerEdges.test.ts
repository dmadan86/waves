import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUndoScheduler } from '../src/lib/undoScheduler';

afterEach(() => vi.useRealTimers());

describe('undo scheduler edges', () => {
  it('a rapid double tap on one key commits once, with the latest action', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const a = vi.fn();
    const b = vi.fn();
    s.schedule('paid:r1:d', a, 5000);
    s.schedule('paid:r1:d', b, 5000);
    vi.advanceTimersByTime(10_000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('taps on different keys each commit', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const a = vi.fn();
    const b = vi.fn();
    s.schedule('x', a, 5000);
    s.schedule('y', b, 5000);
    vi.advanceTimersByTime(5000);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('cancel after the commit is a no-op that reports false', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const commit = vi.fn();
    s.schedule('k', commit, 1000);
    vi.advanceTimersByTime(1000);
    expect(s.cancel('k')).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('cancel twice only succeeds once and never commits', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const commit = vi.fn();
    s.schedule('k', commit, 1000);
    expect(s.cancel('k')).toBe(true);
    expect(s.cancel('k')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(commit).not.toHaveBeenCalled();
  });

  it('flush (app backgrounded) commits everything now, once, and later timers do nothing', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const a = vi.fn();
    const b = vi.fn();
    s.schedule('a', a, 5000);
    s.schedule('b', b, 5000);
    s.flush();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(s.has('a')).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    s.flush();
    expect(a).toHaveBeenCalledOnce();
  });

  it('onExpire runs after commit on timer expiry, not on flush or cancel', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const order: string[] = [];
    s.schedule(
      't',
      () => order.push('commit'),
      100,
      () => order.push('expire'),
    );
    vi.advanceTimersByTime(100);
    expect(order).toEqual(['commit', 'expire']);
    const expire = vi.fn();
    s.schedule('f', () => {}, 100, expire);
    s.flush();
    s.schedule('c', () => {}, 100, expire);
    s.cancel('c');
    vi.advanceTimersByTime(1000);
    expect(expire).not.toHaveBeenCalled();
  });

  it('clear drops pending work without committing', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const commit = vi.fn();
    s.schedule('a', commit, 100);
    s.clear();
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
    expect(s.has('a')).toBe(false);
  });

  it('a commit that re-schedules its own key is not lost', () => {
    vi.useFakeTimers();
    const s = createUndoScheduler();
    const again = vi.fn();
    s.schedule('k', () => s.schedule('k', again, 100), 100);
    vi.advanceTimersByTime(100);
    expect(s.has('k')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(again).toHaveBeenCalledOnce();
  });
});
