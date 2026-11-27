import { afterEach, describe, expect, it, vi } from 'vitest';

import { createForegroundPoll } from '../src/e2ee/poll';

describe('couple mailbox foreground poll', () => {
  afterEach(() => vi.useRealTimers());

  it('runs every interval while started and has work, and stops on stop()', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const poll = createForegroundPoll(run, () => true, 10_000);
    poll.start();
    vi.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(3);
    poll.stop();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does nothing when there is no couple space, and start twice is one timer', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    let has = false;
    const poll = createForegroundPoll(run, () => has, 10_000);
    poll.start();
    poll.start();
    vi.advanceTimersByTime(20_000);
    expect(run).not.toHaveBeenCalled();
    has = true;
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
