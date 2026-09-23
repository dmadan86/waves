/**
 * The app's motion components: each plays its entrance or press spring, and
 * each stands still when the OS asks for reduced motion.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DetailEnter, PressableScale, Stagger, TRANSITION_MS } from '../src/lib/anim';
import { staggerDelay } from '../src/lib/motionMath';
import { renderHook, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({ reduce: false }));

vi.mock('react-native', () => ({ Pressable: 'Pressable' }));
vi.mock('../src/lib/reducedMotion', () => ({ useReducedMotion: () => env.reduce }));
vi.mock('react-native-reanimated', async () => {
  const react = await import('./support/fakeReact');
  const fade = (duration = 0, delay = 0) => ({
    kind: 'FadeInDown',
    duration: (d: number) => fade(d, delay),
    delay: (d: number) => fade(duration, d),
    value: { duration, delay },
  });
  return {
    default: {
      View: 'Animated.View',
      createAnimatedComponent: (c: unknown) => `Animated(${String(c)})`,
    },
    FadeInDown: fade(),
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
    withSpring: (to: number, config: unknown) => ({ spring: to, config }),
    withTiming: (to: number, config: unknown) => ({ timing: to, config }),
  };
});

beforeEach(() => {
  env.reduce = false;
});

describe('Stagger', () => {
  it('fades each row up a capped beat after the one above', () => {
    const el = renderHook(() => Stagger({ index: 3, children: 'row' })).result
      .current as FakeElement;
    expect(el.type).toBe('Animated.View');
    expect((el.props.entering as { value: unknown }).value).toEqual({
      duration: 340,
      delay: staggerDelay(3),
    });
    expect(el.props.children).toBe('row');
  });

  it('defaults to the first row, and does not animate under reduced motion', () => {
    expect(
      (renderHook(() => Stagger({ children: null })).result.current as FakeElement).props.entering,
    ).toMatchObject({ value: { delay: staggerDelay(0) } });
    env.reduce = true;
    expect(
      (renderHook(() => Stagger({ children: null })).result.current as FakeElement).props.entering,
    ).toBeUndefined();
  });
});

describe('PressableScale', () => {
  it('dips under the finger and springs back, passing the events on', () => {
    const onPressIn = vi.fn();
    const onPressOut = vi.fn();
    const el = renderHook(() =>
      PressableScale({ children: 'x', onPressIn, onPressOut, style: { margin: 1 } }),
    ).result.current as FakeElement;
    expect(el.type).toBe('Animated(Pressable)');
    const [animated, own] = el.props.style as [{ animated: () => unknown }, unknown];
    expect(own).toEqual({ margin: 1 });
    expect(animated.animated()).toEqual({ transform: [{ scale: 1 }] });

    (el.props.onPressIn as (e: unknown) => void)('in');
    expect(animated.animated()).toMatchObject({ transform: [{ scale: { spring: 0.96 } }] });
    expect(onPressIn).toHaveBeenCalledWith('in');

    (el.props.onPressOut as (e: unknown) => void)('out');
    expect(animated.animated()).toMatchObject({ transform: [{ scale: { spring: 1 } }] });
    expect(onPressOut).toHaveBeenCalledWith('out');
  });

  it('stays still under reduced motion, and tolerates having no handlers', () => {
    env.reduce = true;
    const el = renderHook(() => PressableScale({ children: 'x' })).result.current as FakeElement;
    const [animated] = el.props.style as [{ animated: () => unknown }];
    (el.props.onPressIn as (e: unknown) => void)('in');
    (el.props.onPressOut as (e: unknown) => void)('out');
    expect(animated.animated()).toEqual({ transform: [{ scale: 1 }] });
  });
});

describe('DetailEnter', () => {
  it('springs the screen up from just under full size while it fades in', () => {
    const el = renderHook(() => DetailEnter({ children: 'screen', style: { padding: 2 } })).result
      .current as FakeElement;
    expect(el.props.style).toEqual([{ flex: 1 }, { padding: 2 }]);
    const entering = el.props.entering as () => {
      initialValues: unknown;
      animations: { opacity: unknown; transform: unknown };
    };
    const frame = entering();
    expect(frame.initialValues).toEqual({ opacity: 0, transform: [{ scale: 0.97 }] });
    expect(frame.animations.opacity).toEqual({ timing: 1, config: { duration: 220 } });
    expect(frame.animations.transform).toEqual([
      { scale: { spring: 1, config: { damping: 20, stiffness: 200 } } },
    ]);
  });

  it('just appears under reduced motion', () => {
    env.reduce = true;
    const el = renderHook(() => DetailEnter({ children: null })).result.current as FakeElement;
    expect(el.props.entering).toBeUndefined();
  });
});

it('keeps screen transitions short', () => {
  expect(TRANSITION_MS).toBeLessThan(400);
});
