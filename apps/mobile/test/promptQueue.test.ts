/**
 * The one-at-a-time prompt queue: the highest live claim wins the screen, a
 * slot is granted only after its own delay, and a higher claim arriving stands
 * a waiting or showing slot straight back down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptQueueProvider, usePromptQueueClear, usePromptSlot } from '../src/lib/promptQueue';
import { firstProvider, renderHook, type FakeContext } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

type Queue = {
  claim: (id: string, p: number) => void;
  release: (id: string) => void;
  winnerId: string | null;
};

function mountQueue() {
  const provider = renderHook(() => PromptQueueProvider({ children: null }));
  const value = () => firstProvider(provider.result.current)!.value as Queue;
  const ctx = firstProvider(provider.result.current)!.ctx as FakeContext<unknown>;
  // Consumers read the provider's latest value through this view, so a
  // re-render of a consumer sees what the provider holds now.
  const consumerValue: Queue = {
    claim: (id, p) => value().claim(id, p),
    release: (id) => value().release(id),
    get winnerId() {
      return value().winnerId;
    },
  };
  return { value, ctx, consumerValue };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the queue', () => {
  it('names the highest live claim as the winner, and the next one when it releases', () => {
    const { value } = mountQueue();
    expect(value().winnerId).toBeNull();

    value().claim('tip', 1);
    value().claim('tour', 10);
    expect(value().winnerId).toBe('tour');

    const before = value();
    value().claim('tour', 10);
    expect(value()).toBe(before);

    value().release('tour');
    expect(value().winnerId).toBe('tip');

    value().release('nobody');
    value().release('tip');
    expect(value().winnerId).toBeNull();
  });
});

describe('usePromptQueueClear', () => {
  it('is clear with no provider, and clear only while nobody holds the screen', () => {
    expect(renderHook(() => usePromptQueueClear()).result.current).toBe(true);

    const { value, ctx } = mountQueue();
    expect(
      renderHook(() => usePromptQueueClear(), { contexts: [[ctx, value()]] }).result.current,
    ).toBe(true);
    value().claim('tip', 1);
    expect(
      renderHook(() => usePromptQueueClear(), { contexts: [[ctx, value()]] }).result.current,
    ).toBe(false);
  });
});

describe('usePromptSlot', () => {
  it('is granted after its delay once it wins, and stands down when a higher claim arrives', () => {
    const { value, ctx, consumerValue } = mountQueue();
    const tip = renderHook(
      (active: boolean) => usePromptSlot({ id: 'tip', priority: 1, active, delayMs: 500 }),
      { props: true, contexts: [[ctx, consumerValue]] },
    );
    tip.rerender();
    expect(value().winnerId).toBe('tip');
    expect(tip.result.current).toBe(false);

    vi.advanceTimersByTime(499);
    expect(tip.result.current).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tip.result.current).toBe(true);

    value().claim('tour', 10);
    tip.rerender();
    expect(tip.result.current).toBe(false);

    value().release('tour');
    tip.rerender();
    vi.advanceTimersByTime(500);
    expect(tip.result.current).toBe(true);
  });

  it('releases its claim when it goes inactive or unmounts', () => {
    const { value, ctx, consumerValue } = mountQueue();
    const slot = renderHook(
      (active: boolean) => usePromptSlot({ id: 'push', priority: 5, active }),
      { props: true, contexts: [[ctx, consumerValue]] },
    );
    expect(value().winnerId).toBe('push');

    slot.rerender(false);
    expect(value().winnerId).toBeNull();

    slot.rerender(true);
    slot.rerender();
    vi.advanceTimersByTime(0);
    expect(slot.result.current).toBe(true);

    slot.unmount();
    expect(value().winnerId).toBeNull();
  });

  it('must be inside a provider', () => {
    expect(() => renderHook(() => usePromptSlot({ id: 'x', priority: 1, active: true }))).toThrow(
      /within a PromptQueueProvider/,
    );
  });
});
