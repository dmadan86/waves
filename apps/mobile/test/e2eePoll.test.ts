import { afterEach, describe, expect, it, vi } from 'vitest';

import { createForegroundPoll } from '../src/e2ee/poll';

describe('couple mailbox foreground poll', () => {
  afterEach(() => vi.useRealTimers());

  it('polls every 10s, stops on stop(), and start twice is one timer', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 1);
    const poll = createForegroundPoll(run, () => true, 10_000);
    poll.start();
    poll.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(3);
    poll.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does nothing without a couple space', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 1);
    let has = false;
    const poll = createForegroundPoll(run, () => has, 10_000);
    poll.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).not.toHaveBeenCalled();
    has = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it('backs off while quiet and returns to 10s when mail arrives', async () => {
    vi.useFakeTimers();
    let applied = 0;
    const run = vi.fn(async () => applied);
    const poll = createForegroundPoll(run, () => true, 10_000);
    poll.start();
    await vi.advanceTimersByTimeAsync(120_000); // 12 quiet polls
    expect(run).toHaveBeenCalledTimes(12);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(13);
    applied = 2;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(14);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(15);
    poll.stop();
  });
});
