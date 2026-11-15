import { describe, expect, it, vi } from 'vitest';
import { createOverlayCloseGuard } from '../../../packages/ui/src/overlayCloseGuard';

describe('overlay close guard', () => {
  it('allows the fallback to close when the animation callback is lost', () => {
    vi.useFakeTimers();
    const guard = createOverlayCloseGuard();
    guard.request(true);
    guard.begin();
    guard.request(false);
    const generation = guard.begin();
    const unmount = vi.fn();
    setTimeout(() => {
      if (guard.canClose(generation)) unmount();
    }, 500);
    vi.advanceTimersByTime(500);
    expect(unmount).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('rejects old completion and fallback callbacks after reopening or cleanup', () => {
    const guard = createOverlayCloseGuard();
    const closing = guard.begin();
    guard.request(true);
    expect(guard.canClose(closing)).toBe(false);
    guard.request(false);
    const latest = guard.begin();
    expect(guard.canClose(closing)).toBe(false);
    expect(guard.canClose(latest)).toBe(true);
    guard.cancel();
    expect(guard.canClose(latest)).toBe(false);
  });
});
