/**
 * `useCrossfade` is the hook `MeterValues` (Settings → Storage) rides to
 * dissolve its skeleton figures into the real ones once the usage query
 * resolves, instead of popping from one to the other. It is exercised in
 * isolation here because the thing that matters — which of the two stays
 * visible, that the swap reverses cleanly, and that reduced motion skips the
 * tween entirely rather than just running it faster — is easy to get backwards
 * in the `1 - sel.get()` arithmetic and hard to catch by eye on a device.
 *
 * `withTiming` is mocked as a bare pass-through to its target value: this
 * suite is about which value the hook lands on and under which condition,
 * not the shape of the tween (that is Reanimated's own concern). What it does
 * assert is whether `withTiming` was reached for at all, which is the one bit
 * of this hook reduced motion is supposed to change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCrossfade } from '../src/lib/anim';
import { renderHook } from './support/fakeReact';

const env = vi.hoisted(() => ({ reduce: false }));
const withTiming = vi.hoisted(() => vi.fn((to: number) => to));

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('react-native', () => ({ Pressable: 'Pressable' }));
vi.mock('../src/lib/reducedMotion', () => ({ useReducedMotion: () => env.reduce }));
vi.mock('react-native-reanimated', async () => {
  const react = await import('./support/fakeReact');
  return {
    default: {
      View: 'Animated.View',
      createAnimatedComponent: (c: unknown) => `Animated(${String(c)})`,
    },
    useSharedValue: (initial: number) => {
      const ref = react.useRef({ v: initial as unknown });
      return {
        get: () => ref.current.v,
        set: (next: unknown) => {
          ref.current.v = next;
        },
      };
    },
    useAnimatedStyle: (fn: () => unknown) => ({ animated: fn }),
    withTiming,
  };
});

beforeEach(() => {
  env.reduce = false;
  withTiming.mockClear();
});

/**
 * `useAnimatedStyle`'s real type is an opaque `AnimatedStyleHandle`; the mock
 * above hands back `{ animated: fn }` instead, so a style is read back through
 * this cast rather than through the type `anim.tsx` sees at compile time.
 */
function animatedOpacity(style: unknown): { opacity: number } {
  return (style as { animated: () => { opacity: number } }).animated();
}

describe('useCrossfade', () => {
  it('starts with the skeleton shown and the real value hidden', () => {
    const { result } = renderHook((active: boolean) => useCrossfade(active, 180), {
      props: false,
    });
    expect(animatedOpacity(result.current.fromStyle)).toEqual({ opacity: 1 });
    expect(animatedOpacity(result.current.toStyle)).toEqual({ opacity: 0 });
  });

  it('swaps which one is visible once the real value is ready', () => {
    const { result, rerender } = renderHook((active: boolean) => useCrossfade(active, 180), {
      props: false,
    });
    rerender(true);
    expect(animatedOpacity(result.current.fromStyle)).toEqual({ opacity: 0 });
    expect(animatedOpacity(result.current.toStyle)).toEqual({ opacity: 1 });
    // Reached for, and with this screen's duration — not some other value a
    // copy-paste left behind.
    expect(withTiming).toHaveBeenCalledWith(1, { duration: 180 });
  });

  it('can reverse — the skeleton returns if the value goes stale again', () => {
    const { result, rerender } = renderHook((active: boolean) => useCrossfade(active, 180), {
      props: true,
    });
    rerender(false);
    expect(animatedOpacity(result.current.fromStyle)).toEqual({ opacity: 1 });
    expect(animatedOpacity(result.current.toStyle)).toEqual({ opacity: 0 });
  });

  it('is a hard cut under reduced motion: no tween is ever reached for', () => {
    env.reduce = true;
    const { result, rerender } = renderHook((active: boolean) => useCrossfade(active, 180), {
      props: false,
    });
    rerender(true);
    // Same end state as the animated case above —
    expect(animatedOpacity(result.current.fromStyle)).toEqual({ opacity: 0 });
    expect(animatedOpacity(result.current.toStyle)).toEqual({ opacity: 1 });
    // — reached directly, not through `withTiming`.
    expect(withTiming).not.toHaveBeenCalled();
  });
});
