/**
 * The product tour's state: whose "seen" flag it reads, how the steps advance,
 * and how a target's measured rectangle reaches the overlay.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TOUR_STEPS, TourProvider, TourTarget, useTour } from '../src/lib/tour';
import { firstProvider, flush, renderHook, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const env = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  seen: new Map<string, boolean>(),
  remembered: [] as string[],
}));

vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: env.session }) }));
vi.mock('@/lib/onboardingSeen', () => ({
  tourSeen: async (owner: string) => env.seen.get(owner) ?? false,
  rememberTourSeen: async (owner: string) => {
    env.remembered.push(owner);
    env.seen.set(owner, true);
  },
}));

type Tour = ReturnType<typeof useTour>;

async function mount() {
  const view = renderHook(() => TourProvider({ children: null }));
  await flush();
  const value = () => firstProvider(view.result.current)!.value as Tour;
  const ctx = firstProvider(view.result.current)!.ctx;
  return { view, value, ctx };
}

beforeEach(() => {
  env.session = { user: { id: 'u1' } };
  env.seen.clear();
  env.remembered = [];
});

describe('whose tour it is', () => {
  it('is not ready and not seen while signed out', async () => {
    env.session = null;
    const { value } = await mount();
    expect(value()).toMatchObject({ ready: false, seen: false, active: false });
  });

  it('reads the seen flag for the signed-in account', async () => {
    env.seen.set('u1', true);
    const { value } = await mount();
    expect(value()).toMatchObject({ ready: true, seen: true, total: TOUR_STEPS.length });
  });

  it('stands back down on an account change until the new answer lands', async () => {
    env.seen.set('u1', true);
    const { view, value } = await mount();

    env.session = { user: { id: 'u2' } };
    view.rerender();
    expect(value()).toMatchObject({ ready: false, seen: false });

    await flush();
    expect(value()).toMatchObject({ ready: true, seen: false });
  });
});

describe('walking the steps', () => {
  it('starts at the first step, goes forward and back, and finishing remembers it', async () => {
    const { value } = await mount();
    value().start();
    expect(value()).toMatchObject({ active: true, step: 0 });

    value().prev();
    expect(value().step).toBe(0);

    value().next();
    value().next();
    expect(value().step).toBe(2);
    value().prev();
    expect(value().step).toBe(1);

    for (let i = 1; i < TOUR_STEPS.length - 1; i++) value().next();
    expect(value().step).toBe(TOUR_STEPS.length - 1);
    expect(value().active).toBe(true);

    value().next();
    expect(value()).toMatchObject({ active: false, seen: true });
    expect(env.remembered).toEqual(['u1']);
  });

  it('can be left early, which also counts as seen', async () => {
    const { value } = await mount();
    value().start();
    value().finish();
    expect(value()).toMatchObject({ active: false, seen: true });
    expect(env.remembered).toEqual(['u1']);
  });

  it('remembers nothing for nobody when signed out', async () => {
    env.session = null;
    const { value } = await mount();
    value().start();
    value().finish();
    expect(env.remembered).toEqual([]);
  });

  it('every step has copy, and the middle ones point at something', () => {
    const t = new Proxy(
      {},
      { get: (_, section) => new Proxy({}, { get: (__, k) => `${String(section)}.${String(k)}` }) },
    );
    for (const step of TOUR_STEPS) {
      expect(step.title(t as never)).toMatch(/^tour\./);
      expect(step.body(t as never)).toMatch(/^tour\./);
    }
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      undefined,
      'hero',
      'addGroup',
      'addExpense',
      undefined,
    ]);
  });
});

describe('targets', () => {
  it('keeps measured rectangles, and re-renders the overlay only while the tour is up', async () => {
    const { view, value } = await mount();
    const rect = { x: 1, y: 2, width: 3, height: 4 };

    const before = view.renders;
    value().register('hero', rect);
    expect(view.renders).toBe(before);
    expect(value().rectFor('hero')).toEqual(rect);
    expect(value().rectFor(undefined)).toBeUndefined();

    value().start();
    const during = view.renders;
    value().register('hero', null);
    expect(view.renders).toBeGreaterThan(during);
    expect(value().rectFor('hero')).toBeUndefined();
  });

  it('a TourTarget registers its window rectangle on layout and clears it on unmount', async () => {
    const { value, ctx } = await mount();
    let measured: [number, number, number, number] = [10, 20, 30, 40];
    const target = renderHook(() => TourTarget({ id: 'addGroup', children: null }), {
      contexts: [[ctx, value()]],
    });
    const view = target.result.current as unknown as FakeElement;
    (view.props.ref as { current: unknown }).current = {
      measureInWindow: (cb: (...a: number[]) => void) => cb(...measured),
    };

    (view.props.onLayout as () => void)();
    expect(value().rectFor('addGroup')).toEqual({ x: 10, y: 20, width: 30, height: 40 });

    // A zero-size measure (not laid out yet) is not a target.
    measured = [0, 0, 0, 0];
    (view.props.onLayout as () => void)();
    expect(value().rectFor('addGroup')).toEqual({ x: 10, y: 20, width: 30, height: 40 });

    target.unmount();
    expect(value().rectFor('addGroup')).toBeUndefined();
  });

  it('refuses to be read outside its provider', () => {
    expect(() => renderHook(() => useTour())).toThrow(/inside TourProvider/);
  });
});
