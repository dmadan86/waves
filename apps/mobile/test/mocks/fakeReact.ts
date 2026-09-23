/**
 * A just-enough React for driving hooks and headless providers under vitest.
 *
 * This suite has no React renderer (see vitest.config.ts): it runs in plain
 * Node, and standing up react-native's renderer would cost far more than the
 * wiring it checks. But a provider like `SyncProvider` is mostly wiring —
 * effects that subscribe, cleanups that unsubscribe, callbacks that call the
 * engine — and that is exactly what a tiny hook runtime can drive honestly.
 *
 * Use it by pointing `react` (and the JSX runtimes, for .tsx) at this module:
 *
 *   vi.mock('react', () => import('./mocks/fakeReact'));
 *   vi.mock('react/jsx-runtime', () => import('./mocks/fakeReact'));
 *   vi.mock('react/jsx-dev-runtime', () => import('./mocks/fakeReact'));
 *
 * then `renderHook(() => useThing())`. Semantics kept deliberately simple and
 * synchronous, like a test renderer inside `act`:
 *
 * - `setState` outside a render re-renders at once, then runs due effects.
 * - Effects run after each render, in order, cleanup-before-rerun, only when
 *   their dependencies changed (`Object.is`, like React).
 * - `useContext` reads what a test `provide`d, else the context's default.
 * - JSX becomes plain `{ type, props }` objects; nothing is mounted, so a
 *   provider's rendered value is read straight off the element it returns.
 */

type Deps = readonly unknown[] | undefined;

interface EffectSlot {
  kind: 'effect';
  deps: Deps;
  cleanup: (() => void) | void;
  pending: (() => (() => void) | void) | null;
}

type Slot =
  | { kind: 'state'; value: unknown }
  | { kind: 'memo'; deps: Deps; value: unknown }
  | { kind: 'ref'; value: { current: unknown } }
  | EffectSlot;

interface Instance {
  slots: Slot[];
  index: number;
  render: () => void;
  rendering: boolean;
  dirty: boolean;
  unmounted: boolean;
}

let current: Instance | null = null;

function depsChanged(prev: Deps, next: Deps): boolean {
  if (prev === undefined || next === undefined) return true;
  if (prev.length !== next.length) return true;
  return prev.some((value, i) => !Object.is(value, next[i]));
}

function slot<T extends Slot>(make: () => T): T {
  const instance = current;
  if (!instance) throw new Error('fakeReact: hook called outside renderHook');
  const i = instance.index++;
  instance.slots[i] ??= make();
  return instance.slots[i] as T;
}

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const instance = current!;
  const s = slot(() => ({
    kind: 'state' as const,
    value: typeof initial === 'function' ? (initial as () => T)() : initial,
  }));
  const set = (next: T | ((prev: T) => T)): void => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(s.value as T) : next;
    if (Object.is(value, s.value)) return;
    s.value = value;
    if (instance.unmounted) return;
    if (instance.rendering) instance.dirty = true;
    else instance.render();
  };
  return [s.value as T, set];
}

export function useRef<T>(initial: T): { current: T } {
  return slot(() => ({ kind: 'ref' as const, value: { current: initial as unknown } })).value as {
    current: T;
  };
}

export function useMemo<T>(factory: () => T, deps: Deps): T {
  const s = slot(() => ({
    kind: 'memo' as const,
    deps: undefined as Deps,
    value: undefined as unknown,
  }));
  if (s.deps === undefined || depsChanged(s.deps, deps)) {
    s.value = factory();
    s.deps = deps;
  }
  return s.value as T;
}

export function useCallback<T>(fn: T, deps: Deps): T {
  // This *is* the hook implementation, so the caller's deps are forwarded as-is.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn, deps);
}

export function useEffect(effect: () => (() => void) | void, deps?: Deps): void {
  const s = slot<EffectSlot>(() => ({
    kind: 'effect',
    deps: undefined,
    cleanup: undefined,
    pending: null,
  }));
  const first = s.pending === null && s.cleanup === undefined && s.deps === undefined;
  if (first || depsChanged(s.deps, deps)) {
    s.pending = effect;
    s.deps = deps;
  }
}
export const useLayoutEffect = useEffect;

export interface FakeContext<T> {
  readonly $$fakeContext: true;
  readonly defaultValue: T;
  value: T | typeof UNSET;
  Provider: (props: { value: T; children?: unknown }) => unknown;
}

const UNSET = Symbol('unset');

export function createContext<T>(defaultValue: T): FakeContext<T> {
  const ctx: FakeContext<T> = {
    $$fakeContext: true,
    defaultValue,
    value: UNSET,
    Provider: (props) => props.children,
  };
  // So a test can find the context behind a `<Ctx.Provider>` element a
  // component returned, and `provide` it to a consumer (see `contextOf`).
  (ctx.Provider as { context?: unknown }).context = ctx;
  return ctx;
}

export function useContext<T>(ctx: FakeContext<T>): T {
  return ctx.value === UNSET ? ctx.defaultValue : (ctx.value as T);
}

/** The context behind a `<Ctx.Provider value>` element. */
export function contextOf(element: unknown): FakeContext<unknown> {
  return ((element as FakeElement).type as { context: FakeContext<unknown> }).context;
}

/** Make `useContext(ctx)` return `value` until {@link resetContexts}. */
export function provide<T>(ctx: unknown, value: T): void {
  (ctx as FakeContext<T>).value = value;
  provided.add(ctx as FakeContext<unknown>);
}
const provided = new Set<FakeContext<unknown>>();
export function resetContexts(): void {
  for (const ctx of provided) ctx.value = UNSET;
  provided.clear();
}

export const Fragment = Symbol.for('fake.fragment');

export interface FakeElement {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

export function jsx(type: unknown, props: Record<string, unknown>): FakeElement {
  return { type, props };
}
export const jsxs = jsx;
export const jsxDEV = jsx;
export function createElement(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): FakeElement {
  return {
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  };
}

export function memo<T>(component: T): T {
  return component;
}
export function forwardRef<T>(component: T): T {
  return component;
}

const React = {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  Fragment,
  createElement,
  memo,
  forwardRef,
};
export default React;

export interface RenderedHook<R> {
  /** The latest value the hook returned. */
  readonly result: { current: R };
  /** How many times it has rendered. */
  readonly renders: () => number;
  /** Render again with new props (for hooks that take arguments). */
  rerender: (props?: unknown) => void;
  /** Run every effect cleanup, as an unmount would. */
  unmount: () => void;
}

/**
 * Render a hook (or a function component) and keep it mounted.
 *
 * `hook` receives the latest props passed to `rerender`.
 */
export function renderHook<R, P = undefined>(
  hook: (props: P) => R,
  initialProps?: P,
): RenderedHook<R> {
  let props = initialProps as P;
  let count = 0;
  const result = { current: undefined as unknown as R };
  const instance: Instance = {
    slots: [],
    index: 0,
    rendering: false,
    dirty: false,
    unmounted: false,
    render: () => {
      if (instance.unmounted) return;
      let guard = 0;
      do {
        instance.dirty = false;
        instance.rendering = true;
        instance.index = 0;
        const previous = current;
        current = instance;
        try {
          result.current = hook(props);
          count += 1;
        } finally {
          current = previous;
          instance.rendering = false;
        }
        if (++guard > 50) throw new Error('fakeReact: render loop');
      } while (instance.dirty);
      flushEffects();
    },
  };

  const flushEffects = (): void => {
    for (const s of instance.slots) {
      if (s.kind !== 'effect' || !s.pending) continue;
      const effect = s.pending;
      s.pending = null;
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = effect();
      if (instance.unmounted) return;
    }
  };

  instance.render();
  return {
    result,
    renders: () => count,
    rerender: (next?: unknown) => {
      if (next !== undefined) props = next as P;
      instance.render();
    },
    unmount: () => {
      instance.unmounted = true;
      for (const s of instance.slots) {
        if (s.kind === 'effect' && typeof s.cleanup === 'function') {
          s.cleanup();
          s.cleanup = undefined;
        }
      }
    },
  };
}
