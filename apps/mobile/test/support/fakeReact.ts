/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/purity, react-hooks/exhaustive-deps --
 * This file IS the hook implementation, so React's own lint rules about calling
 * hooks do not describe it. */
/**
 * A tiny, synchronous stand-in for React's hooks, for driving hook and provider
 * logic under vitest's node environment (there is no React Native renderer in
 * this suite — see vitest.config.ts).
 *
 * It is not a renderer. A component or hook is a plain function: `renderHook`
 * calls it, records its hook slots, runs its effects straight after the call
 * (deps compared the React way), and calls it again whenever state changes. JSX
 * becomes inert `{ type, props }` objects that a test can search with
 * `findAll` and poke (`node.props.onPress()`), but child components are never
 * rendered — every test is shallow.
 *
 * Use it from a test file with:
 *
 *   vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
 *   vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
 *
 * and then `renderHook(() => useThing())` from this module.
 */

type Deps = readonly unknown[] | undefined;

type EffectSlot = {
  kind: 'effect';
  deps: Deps;
  cleanup?: (() => void) | void;
  pending?: () => (() => void) | void;
};

type Slot =
  | { kind: 'state'; value: unknown; set: (next: unknown) => void }
  | { kind: 'ref'; value: { current: unknown } }
  | { kind: 'memo'; value: unknown; deps: Deps }
  | { kind: 'store'; unsubscribe?: () => void; subscribe?: unknown }
  | EffectSlot;

export type FakeContext<T> = {
  $$fakeContext: true;
  defaultValue: T;
  Provider: { $$provider: FakeContext<T> };
  Consumer: { $$consumer: FakeContext<T> };
  displayName?: string;
};

export type FakeElement = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
  key: unknown;
};

class Instance<P, R> {
  slots: Slot[] = [];
  index = 0;
  rendering = false;
  inEffects = false;
  dirty = false;
  mounted = true;
  result!: R;
  renders = 0;
  constructor(
    public fn: (props: P) => R,
    public props: P,
    public contexts: Map<unknown, unknown>,
  ) {}

  render(): void {
    let guard = 0;
    do {
      if (++guard > 100) throw new Error('fakeReact: render loop did not settle');
      this.dirty = false;
      this.index = 0;
      this.rendering = true;
      const previous = current;
      current = this as Instance<unknown, unknown>;
      try {
        this.result = this.fn(this.props);
        this.renders++;
      } finally {
        current = previous;
        this.rendering = false;
      }
      this.runEffects();
    } while (this.dirty && this.mounted);
  }

  runEffects(): void {
    this.inEffects = true;
    try {
      for (const slot of this.slots) {
        if (slot.kind !== 'effect' || !slot.pending) continue;
        const run = slot.pending;
        slot.pending = undefined;
        if (typeof slot.cleanup === 'function') slot.cleanup();
        slot.cleanup = run();
      }
    } finally {
      this.inEffects = false;
    }
  }

  schedule(): void {
    if (!this.mounted) return;
    if (this.rendering || this.inEffects) {
      this.dirty = true;
      return;
    }
    if (flushing) {
      this.dirty = true;
      return;
    }
    this.render();
  }

  unmount(): void {
    this.mounted = false;
    for (const slot of this.slots) {
      if (slot.kind === 'effect' && typeof slot.cleanup === 'function') {
        slot.cleanup();
        slot.cleanup = undefined;
      }
      if (slot.kind === 'store' && slot.unsubscribe) slot.unsubscribe();
    }
  }
}

let current: Instance<unknown, unknown> | null = null;
let flushing = false;
const live = new Set<Instance<unknown, unknown>>();

function instance(): Instance<unknown, unknown> {
  if (!current) throw new Error('fakeReact: hook called outside renderHook');
  return current;
}

function depsChanged(prev: Deps, next: Deps): boolean {
  if (!prev || !next) return true;
  if (prev.length !== next.length) return true;
  return prev.some((value, i) => !Object.is(value, next[i]));
}

function slot<T extends Slot>(make: () => T): { slot: T; fresh: boolean } {
  const inst = instance();
  const i = inst.index++;
  const existing = inst.slots[i];
  if (existing) return { slot: existing as T, fresh: false };
  const created = make();
  inst.slots[i] = created;
  return { slot: created, fresh: true };
}

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const inst = instance();
  const { slot: s } = slot(() => {
    const created: { kind: 'state'; value: unknown; set: (next: unknown) => void } = {
      kind: 'state',
      value: typeof initial === 'function' ? (initial as () => T)() : initial,
      set: () => {},
    };
    created.set = (next: unknown) => {
      const value =
        typeof next === 'function' ? (next as (prev: unknown) => unknown)(created.value) : next;
      if (Object.is(value, created.value)) return;
      created.value = value;
      inst.schedule();
    };
    return created;
  });
  return [s.value as T, s.set as (next: T | ((prev: T) => T)) => void];
}

export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialArg: S,
  init?: (arg: S) => S,
): [S, (action: A) => void] {
  const [state, setState] = useState<S>(() => (init ? init(initialArg) : initialArg));
  const ref = useRef(reducer);
  ref.current = reducer;
  const dispatch = useCallbackStable((action: A) => setState((prev) => ref.current(prev, action)));
  return [state, dispatch];
}

function useCallbackStable<F>(fn: F): F {
  const { slot: s } = slot(() => ({ kind: 'ref' as const, value: { current: fn as unknown } }));
  return s.value.current as F;
}

export function useRef<T>(initial: T): { current: T } {
  const { slot: s } = slot(() => ({
    kind: 'ref' as const,
    value: { current: initial as unknown },
  }));
  return s.value as { current: T };
}

export function useMemo<T>(factory: () => T, deps: Deps): T {
  const inst = instance();
  const i = inst.index;
  const existing = inst.slots[i] as { kind: 'memo'; value: unknown; deps: Deps } | undefined;
  inst.index++;
  if (existing && !depsChanged(existing.deps, deps)) return existing.value as T;
  const value = factory();
  inst.slots[i] = { kind: 'memo', value, deps };
  return value;
}

export function useCallback<T>(fn: T, deps: Deps): T {
  return useMemo(() => fn, deps);
}

export function useEffect(effect: () => (() => void) | void, deps?: Deps): void {
  const { slot: s, fresh } = slot<EffectSlot>(() => ({ kind: 'effect', deps: undefined }));
  if (fresh || depsChanged(s.deps, deps)) {
    s.deps = deps;
    s.pending = effect;
  }
}

export const useLayoutEffect = useEffect;
export const useInsertionEffect = useEffect;

export function useImperativeHandle<T>(
  ref: { current: T | null } | ((value: T | null) => void) | null | undefined,
  create: () => T,
  deps?: Deps,
): void {
  useEffect(() => {
    const value = create();
    if (typeof ref === 'function') ref(value);
    else if (ref) ref.current = value;
  }, deps);
}

export function useSyncExternalStore<T>(
  subscribe: (onChange: () => void) => () => void,
  getSnapshot: () => T,
): T {
  const inst = instance();
  const { slot: s } = slot(() => ({ kind: 'store' as const }) as Slot & { kind: 'store' });
  if (s.subscribe !== subscribe) {
    s.unsubscribe?.();
    s.subscribe = subscribe;
    s.unsubscribe = subscribe(() => inst.schedule());
  }
  return getSnapshot();
}

export function useId(): string {
  const ref = useRef(`:fake${Math.random().toString(36).slice(2, 8)}:`);
  return ref.current;
}

export function useDebugValue(): void {}

export function useDeferredValue<T>(value: T): T {
  return value;
}

export function useTransition(): [boolean, (fn: () => void) => void] {
  return [false, (fn) => fn()];
}

export function startTransition(fn: () => void): void {
  fn();
}

export function createContext<T>(defaultValue: T): FakeContext<T> {
  const ctx = { $$fakeContext: true, defaultValue } as FakeContext<T>;
  ctx.Provider = { $$provider: ctx };
  ctx.Consumer = { $$consumer: ctx };
  return ctx;
}

export function useContext<T>(ctx: FakeContext<T>): T {
  const inst = instance();
  return (inst.contexts.has(ctx) ? inst.contexts.get(ctx) : ctx.defaultValue) as T;
}

export function use<T>(value: FakeContext<T>): T {
  return useContext(value);
}

export function createElement(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): FakeElement {
  const { key, ...rest } = props ?? {};
  const kids =
    children.length === 0 ? rest.children : children.length === 1 ? children[0] : children;
  return { type, key, props: { ...rest, ...(kids === undefined ? {} : { children: kids }) } };
}

function jsx(type: unknown, props: Record<string, unknown>, key?: unknown): FakeElement {
  return { type, key, props: props ?? {} };
}

export function memo<T>(component: T): T {
  return component;
}

export function forwardRef<P, R>(render: (props: P, ref: R) => unknown) {
  return (props: P & { ref?: R }) => render(props, props.ref as R);
}

export function lazy<T>(load: () => Promise<{ default: T }>) {
  return load;
}

export const Fragment = 'Fragment';
export const StrictMode = 'StrictMode';
export const Suspense = 'Suspense';

export function isValidElement(value: unknown): value is FakeElement {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

export function cloneElement(element: FakeElement, props: Record<string, unknown>): FakeElement {
  return { ...element, props: { ...element.props, ...props } };
}

export const Children = {
  toArray(children: unknown): unknown[] {
    return flatten(children).filter((c) => c !== null && c !== undefined && c !== false);
  },
  map(children: unknown, fn: (child: unknown, index: number) => unknown): unknown[] {
    return Children.toArray(children).map(fn);
  },
  forEach(children: unknown, fn: (child: unknown, index: number) => void): void {
    Children.toArray(children).forEach(fn);
  },
  count(children: unknown): number {
    return Children.toArray(children).length;
  },
  only(children: unknown): unknown {
    return Children.toArray(children)[0];
  },
};

function flatten(value: unknown): unknown[] {
  return Array.isArray(value) ? value.flatMap(flatten) : [value];
}

export class Component {
  props: unknown;
  constructor(props: unknown) {
    this.props = props;
  }
}
export class PureComponent extends Component {}

const hooks = {
  useState,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useImperativeHandle,
  useSyncExternalStore,
  useId,
  useDebugValue,
  useDeferredValue,
  useTransition,
  startTransition,
  createContext,
  useContext,
  use,
  createElement,
  memo,
  forwardRef,
  lazy,
  Fragment,
  StrictMode,
  Suspense,
  isValidElement,
  cloneElement,
  Children,
  Component,
  PureComponent,
};

/** The object to hand `vi.mock('react', …)`. */
export function reactModule() {
  return { ...hooks, default: hooks };
}

/** The object to hand `vi.mock('react/jsx-runtime', …)`. */
export function jsxModule() {
  return { jsx, jsxs: jsx, jsxDEV: jsx, Fragment };
}

export type Rendered<P, R> = {
  /** What the last call returned. */
  readonly result: { readonly current: R };
  /** How many times the function has been called. */
  readonly renders: number;
  /** Call the function again, optionally with new props. */
  rerender(props?: P): void;
  /** Run every effect cleanup, as an unmount would. */
  unmount(): void;
};

/**
 * Mount `fn` as a component: call it, run its effects, and keep re-calling it
 * whenever its state changes. `contexts` supplies values for `useContext`.
 */
export function renderHook<R, P = undefined>(
  fn: (props: P) => R,
  options: { props?: P; contexts?: [FakeContext<unknown> | unknown, unknown][] } = {},
): Rendered<P, R> {
  const inst = new Instance<P, R>(fn, options.props as P, new Map(options.contexts ?? []));
  live.add(inst as Instance<unknown, unknown>);
  inst.render();
  return {
    result: {
      get current() {
        return inst.result;
      },
    },
    get renders() {
      return inst.renders;
    },
    rerender(props?: P) {
      if (props !== undefined) inst.props = props;
      inst.render();
    },
    unmount() {
      live.delete(inst as Instance<unknown, unknown>);
      inst.unmount();
    },
  };
}

/**
 * Run `fn` (typically a state setter or a handler) with re-renders batched until
 * it returns, the way React batches updates inside an event handler.
 */
export function act<T>(fn: () => T): T {
  flushing = true;
  let out: T;
  try {
    out = fn();
  } finally {
    flushing = false;
  }
  for (const inst of live) if (inst.dirty && inst.mounted) inst.render();
  return out;
}

/** Let pending promise callbacks (and the re-renders they cause) run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Every element in a JSX tree the predicate accepts, depth first. */
export function findAll(tree: unknown, predicate: (node: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isValidElement(node)) return;
    if (predicate(node)) found.push(node);
    for (const value of Object.values(node.props)) visit(value);
  };
  visit(tree);
  return found;
}

/** The Provider element's `value` for `ctx` in a JSX tree, or undefined. */
export function providedValue<T>(tree: unknown, ctx: FakeContext<T>): T | undefined {
  const [provider] = findAll(
    tree,
    (n) =>
      n.type === ctx.Provider ||
      n.type === ctx ||
      (n.type as { $$provider?: unknown })?.$$provider === ctx,
  );
  return provider?.props.value as T | undefined;
}

/** All the text strings in a JSX tree, in order. */
export function textOf(tree: unknown): string {
  const out: string[] = [];
  const visit = (node: unknown) => {
    if (typeof node === 'string' || typeof node === 'number') out.push(String(node));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (isValidElement(node)) visit(node.props.children);
  };
  visit(tree);
  return out.join('');
}

/**
 * The first context Provider in a JSX tree: its context and the value it
 * provides. For modules that keep their context private, this is how a test
 * gets both the value and the handle `useContext` needs.
 */
export function firstProvider(
  tree: unknown,
): { ctx: FakeContext<unknown>; value: unknown } | undefined {
  const [provider] = findAll(
    tree,
    (n) =>
      typeof n.type === 'object' &&
      n.type !== null &&
      ('$$provider' in n.type || '$$fakeContext' in n.type),
  );
  if (!provider) return undefined;
  const type = provider.type as { $$provider?: FakeContext<unknown> } & FakeContext<unknown>;
  return { ctx: type.$$provider ?? type, value: provider.props.value };
}

/** The context behind one `<Ctx.Provider value>` element, for nested providers. */
export function contextOf(element: unknown): FakeContext<unknown> {
  const type = (element as FakeElement).type as { $$provider?: FakeContext<unknown> };
  if (!type?.$$provider) throw new Error('fakeReact: not a context Provider element');
  return type.$$provider;
}

/** Find the single element whose props match, or throw with what was there. */
export function findOne(tree: unknown, predicate: (node: FakeElement) => boolean): FakeElement {
  const found = findAll(tree, predicate);
  if (found.length !== 1) throw new Error(`fakeReact: expected one match, found ${found.length}`);
  return found[0]!;
}
