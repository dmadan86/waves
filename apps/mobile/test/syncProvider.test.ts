/**
 * `SyncProvider` — the engine wired to the app's lifecycle.
 *
 * The rules about *what* a session ending destroys are pure and tested in
 * `sessionRetention.test.ts`. This covers the other half: that the provider
 * actually carries those answers out at the right moment — the wipe on a
 * deliberate sign-out, the hold on a lost session, the retained-work verdict
 * before a sign-in hydrates, and the foreground/network/timer triggers that make
 * "syncs on connectivity, foreground or push" true.
 *
 * Driven through `test/mocks/fakeReact`, a hook runtime with no renderer: the
 * provider renders nothing but context, so the value it hands down is read
 * straight off the element it returns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MutationKind, type QueuedMutation } from '@waves/core';

import {
  clearDraft,
  SyncProvider,
  useDraft,
  useLastSyncedAt,
  useRestoredDraft,
  useSync,
} from '@/sync/provider';
import { forgetSignOutMark, markDeliberateSignOut } from '@/sync/retention';

import { contextOf, provide, renderHook, resetContexts, type FakeElement } from './mocks/fakeReact';

vi.mock('react', () => import('./mocks/fakeReact'));
vi.mock('react/jsx-runtime', () => import('./mocks/fakeReact'));
vi.mock('react/jsx-dev-runtime', () => import('./mocks/fakeReact'));

const h = vi.hoisted(() => {
  type Listener = (value: unknown) => void;
  const appStateListeners: Listener[] = [];
  const networkListeners: Listener[] = [];
  const auth: { session: { user: { id: string } } | null } = { session: null };
  let engineState = {
    status: 'idle',
    hydrated: false,
    mirror: { tables: {} },
    queue: [] as unknown[],
    rejected: [] as unknown[],
    lastSyncedAt: null as string | null,
    lastError: null as string | null,
  };
  const subscribers: ((s: typeof engineState) => void)[] = [];
  const engine = {
    getState: vi.fn(() => engineState),
    subscribe: vi.fn((listener: (s: typeof engineState) => void) => {
      subscribers.push(listener);
      return () => subscribers.splice(subscribers.indexOf(listener), 1);
    }),
    emit(next: Partial<typeof engineState>) {
      engineState = { ...engineState, ...next };
      for (const s of [...subscribers]) s(engineState);
    },
    reset() {
      engineState = {
        status: 'idle',
        hydrated: false,
        mirror: { tables: {} },
        queue: [],
        rejected: [],
        lastSyncedAt: null,
        lastError: null,
      };
      subscribers.length = 0;
    },
    subscriberCount: () => subscribers.length,
    hydrate: vi.fn(async () => undefined),
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    flush: vi.fn(async (_opts?: unknown) => undefined),
    enqueue: vi.fn(async (_envelope: unknown) => undefined),
    retry: vi.fn(async (_id: string) => undefined),
    discard: vi.fn(async (_id: string) => undefined),
    forgetGroup: vi.fn(async (_id: string) => undefined),
    retainUnsent: vi.fn(async (_owner: string) => undefined),
    retainedWork: vi.fn(async (): Promise<{ ownerId: string; retainedAt: string } | null> => null),
    adoptRetained: vi.fn(async () => undefined),
    saveDraft: vi.fn(async (_key: string, _value: unknown) => undefined),
    readDraft: vi.fn(async (_key: string): Promise<unknown> => null),
    clearDraft: vi.fn(async (_key: string) => undefined),
  };
  return {
    appStateListeners,
    networkListeners,
    auth,
    engine,
    appState: { current: 'active' as string },
    appStateRemoved: vi.fn(),
    networkRemoved: vi.fn(),
    reportHandled: vi.fn(),
    flushReceiptQueue: vi.fn(async () => ({ uploadedExpenseIds: [] as string[] })),
    clearImageCache: vi.fn(),
    clearLocalPrivateData: vi.fn(async (_owner: string): Promise<void> => undefined),
    uuid: vi.fn(() => 'uuid-1'),
  };
});

vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return h.appState.current;
    },
    addEventListener: (_event: string, listener: (value: unknown) => void) => {
      h.appStateListeners.push(listener);
      return { remove: h.appStateRemoved };
    },
  },
}));
vi.mock('expo-network', () => ({
  addNetworkStateListener: (listener: (value: unknown) => void) => {
    h.networkListeners.push(listener);
    return { remove: h.networkRemoved };
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => h.uuid() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: h.auth.session }) }));
vi.mock('@/lib/observability', () => ({ reportHandled: h.reportHandled }));
vi.mock('@/lib/receiptQueue', () => ({ flushReceiptQueue: h.flushReceiptQueue }));
vi.mock('@/lib/storage/imageCache', () => ({ clearImageCache: h.clearImageCache }));
vi.mock('@/sync/engine', () => ({ syncEngine: h.engine }));
vi.mock('@/sync/localWipe', () => ({ clearLocalPrivateData: h.clearLocalPrivateData }));

/** Let the provider's fire-and-forget async chains run to their end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

interface ProvidedValue {
  status: string;
  hasSynced: boolean;
  pendingCount: number;
  mutate: (
    kind: MutationKind,
    groupId: string,
    payload: Record<string, unknown>,
    id?: string,
  ) => Promise<string>;
  flush: (groupIds?: string[]) => Promise<void>;
  retry: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  forgetGroup: (id: string) => Promise<void>;
}

/** Render the provider and read the context value it hands down. */
function mount() {
  const rendered = renderHook(() => SyncProvider({ children: 'app' }) as unknown as FakeElement);
  const value = (): ProvidedValue => rendered.result.current.props.value as ProvidedValue;
  const lastSynced = (): unknown =>
    (rendered.result.current.props.children as FakeElement).props.value;
  return { ...rendered, value, lastSynced };
}

function signIn(id: string): void {
  h.auth.session = { user: { id } };
}
function signOut(): void {
  h.auth.session = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.engine.reset();
  h.appStateListeners.length = 0;
  h.networkListeners.length = 0;
  h.appState.current = 'active';
  h.auth.session = null;
  h.flushReceiptQueue.mockResolvedValue({ uploadedExpenseIds: [] });
  h.engine.retainedWork.mockResolvedValue(null);
  forgetSignOutMark();
});

afterEach(() => {
  resetContexts();
  vi.useRealTimers();
});

describe('SyncProvider — a signed-in launch', () => {
  it('hydrates, starts the poll, flushes and resumes parked receipt uploads', async () => {
    signIn('alice');
    mount();
    await settle();

    expect(h.engine.retainedWork).toHaveBeenCalled();
    expect(h.engine.hydrate).toHaveBeenCalledTimes(1);
    expect(h.engine.start).toHaveBeenCalledTimes(1);
    expect(h.engine.flush).toHaveBeenCalled();
    expect(h.flushReceiptQueue).toHaveBeenCalledTimes(1);
  });

  it('pulls the mirror again when a parked receipt upload lands', async () => {
    h.flushReceiptQueue.mockResolvedValue({ uploadedExpenseIds: ['e1'] });
    signIn('alice');
    mount();
    await settle();
    // Once for the launch flush, once more for the uploaded receipt's row.
    expect(h.engine.flush).toHaveBeenCalledTimes(2);
  });

  it('reports rather than throws when the receipt queue or hydrate fail', async () => {
    h.flushReceiptQueue.mockRejectedValue(new Error('disk'));
    h.engine.hydrate.mockRejectedValueOnce(new Error('sqlite'));
    signIn('alice');
    mount();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.hydrate');
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.resumeReceiptUploads');
    // A failed hydrate still starts the engine — flush records the failure.
    expect(h.engine.start).toHaveBeenCalled();
  });

  it('adopts work retained for the same account inside the window', async () => {
    h.engine.retainedWork.mockResolvedValue({
      ownerId: 'alice',
      retainedAt: new Date().toISOString(),
    });
    signIn('alice');
    mount();
    await settle();
    expect(h.engine.adoptRetained).toHaveBeenCalledTimes(1);
    expect(h.clearLocalPrivateData).not.toHaveBeenCalled();
    expect(h.engine.hydrate).toHaveBeenCalled();
  });

  it("destroys somebody else's retained work before this session hydrates", async () => {
    const order: string[] = [];
    h.engine.retainedWork.mockResolvedValue({
      ownerId: 'bob',
      retainedAt: new Date().toISOString(),
    });
    h.clearLocalPrivateData.mockImplementation(async () => {
      order.push('wipe');
    });
    h.engine.hydrate.mockImplementation(async () => {
      order.push('hydrate');
    });
    signIn('alice');
    mount();
    await settle();
    expect(h.clearLocalPrivateData).toHaveBeenCalledWith('bob');
    expect(h.engine.adoptRetained).not.toHaveBeenCalled();
    expect(order).toEqual(['wipe', 'hydrate']);
  });

  it('reports each retained-work failure and still hydrates', async () => {
    h.engine.retainedWork.mockRejectedValueOnce(new Error('read'));
    signIn('alice');
    mount();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.readRetained');
    expect(h.engine.hydrate).toHaveBeenCalled();
  });

  it('reports a failed adopt and a failed discard', async () => {
    h.engine.retainedWork.mockResolvedValueOnce({
      ownerId: 'alice',
      retainedAt: new Date().toISOString(),
    });
    h.engine.adoptRetained.mockRejectedValueOnce(new Error('adopt'));
    signIn('alice');
    const first = mount();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.adoptRetained');
    first.unmount();

    h.engine.retainedWork.mockResolvedValueOnce({
      ownerId: 'bob',
      retainedAt: new Date().toISOString(),
    });
    h.clearLocalPrivateData.mockRejectedValueOnce(new Error('wipe'));
    mount();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.discardRetained');
  });

  it('stops the engine on unmount and skips the rest of a cancelled start', async () => {
    let release!: () => void;
    h.engine.retainedWork.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(null);
      }),
    );
    signIn('alice');
    const rendered = mount();
    rendered.unmount();
    expect(h.engine.stop).toHaveBeenCalled();
    release();
    await settle();
    expect(h.engine.hydrate).not.toHaveBeenCalled();
    expect(h.engine.start).not.toHaveBeenCalled();
  });
});

describe('SyncProvider — a session ending', () => {
  it('wipes everything on a deliberate sign-out', async () => {
    signIn('alice');
    const rendered = mount();
    await settle();

    markDeliberateSignOut();
    signOut();
    rendered.rerender();
    await settle();

    expect(h.clearLocalPrivateData).toHaveBeenCalledWith('alice');
    expect(h.engine.retainUnsent).not.toHaveBeenCalled();
    expect(h.engine.stop).toHaveBeenCalled();
  });

  it('keeps the unsent queue, stamped with the owner, when the session is lost', async () => {
    signIn('alice');
    const rendered = mount();
    await settle();

    signOut(); // no mark: nobody asked for this
    rendered.rerender();
    await settle();

    expect(h.engine.retainUnsent).toHaveBeenCalledWith('alice');
    expect(h.clearImageCache).toHaveBeenCalled();
    expect(h.clearLocalPrivateData).not.toHaveBeenCalled();
  });

  it('reports a lost-session cleanup that failed, first failure first', async () => {
    h.engine.retainUnsent.mockRejectedValueOnce(new Error('retain'));
    h.clearImageCache.mockImplementationOnce(() => {
      throw new Error('cache');
    });
    signIn('alice');
    const rendered = mount();
    await settle();
    signOut();
    rendered.rerender();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'retain' }),
      'sync.endSession',
    );
  });

  it('makes the next sign-in wait for the previous cleanup to finish', async () => {
    const order: string[] = [];
    let finishWipe!: () => void;
    h.clearLocalPrivateData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWipe = () => {
            order.push('wipe done');
            resolve();
          };
        }),
    );
    h.engine.hydrate.mockImplementation(async () => {
      order.push('hydrate');
    });

    signIn('alice');
    const rendered = mount();
    await settle();
    order.length = 0;

    markDeliberateSignOut();
    signOut();
    rendered.rerender();
    await settle();

    signIn('bob');
    rendered.rerender();
    await settle();
    expect(order).toEqual([]);

    finishWipe();
    await settle();
    expect(order).toEqual(['wipe done', 'hydrate']);
  });

  it('abandons a start whose prior cleanup outlived it', async () => {
    let finishWipe!: () => void;
    h.clearLocalPrivateData.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWipe = resolve;
        }),
    );
    signIn('alice');
    const rendered = mount();
    await settle();
    h.engine.hydrate.mockClear();

    markDeliberateSignOut();
    signOut();
    rendered.rerender();
    signIn('bob');
    rendered.rerender();
    rendered.unmount();
    finishWipe();
    await settle();
    expect(h.engine.hydrate).not.toHaveBeenCalled();
  });

  it('clears the image cache when one account is swapped for another', async () => {
    signIn('alice');
    const rendered = mount();
    await settle();
    expect(h.clearImageCache).not.toHaveBeenCalled();
    signIn('bob');
    rendered.rerender();
    await settle();
    expect(h.clearImageCache).toHaveBeenCalledTimes(1);
  });
});

describe('SyncProvider — a signed-out launch', () => {
  it('sweeps retained work that has outlived the window', async () => {
    h.engine.retainedWork.mockResolvedValue({
      ownerId: 'ghost',
      retainedAt: '2000-01-01T00:00:00Z',
    });
    mount();
    await settle();
    expect(h.clearLocalPrivateData).toHaveBeenCalledWith('ghost');
    expect(h.engine.stop).toHaveBeenCalled();
    expect(h.engine.hydrate).not.toHaveBeenCalled();
  });

  it('leaves retained work inside the window alone', async () => {
    h.engine.retainedWork.mockResolvedValue({
      ownerId: 'ghost',
      retainedAt: new Date().toISOString(),
    });
    mount();
    await settle();
    expect(h.clearLocalPrivateData).not.toHaveBeenCalled();
  });

  it('reports a sweep that failed', async () => {
    h.engine.retainedWork.mockResolvedValue({ ownerId: 'ghost', retainedAt: 'not a date' });
    h.clearLocalPrivateData.mockRejectedValueOnce(new Error('wipe'));
    mount();
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.sweepRetention');
  });

  it('treats an unreadable retained-work marker as nothing to sweep', async () => {
    h.engine.retainedWork.mockRejectedValue(new Error('read'));
    mount();
    await settle();
    expect(h.clearLocalPrivateData).not.toHaveBeenCalled();
    expect(h.reportHandled).not.toHaveBeenCalled();
  });

  it('registers no foreground or network listener', () => {
    mount();
    expect(h.appStateListeners).toHaveLength(0);
    expect(h.networkListeners).toHaveLength(0);
  });
});

describe('SyncProvider — foreground and network triggers', () => {
  it('pauses on a launch into the background and resumes otherwise', () => {
    h.appState.current = 'background';
    signIn('alice');
    mount();
    expect(h.engine.pause).toHaveBeenCalledTimes(1);
    expect(h.engine.resume).not.toHaveBeenCalled();
  });

  it('resumes and flushes on foreground, pauses on background, ignores inactive', async () => {
    signIn('alice');
    mount();
    await settle();
    expect(h.engine.resume).toHaveBeenCalledTimes(1);
    h.engine.flush.mockClear();
    h.flushReceiptQueue.mockClear();

    const onChange = h.appStateListeners[0]!;
    onChange('inactive');
    expect(h.engine.pause).not.toHaveBeenCalled();
    onChange('background');
    expect(h.engine.pause).toHaveBeenCalledTimes(1);
    onChange('active');
    await settle();
    expect(h.engine.resume).toHaveBeenCalledTimes(2);
    expect(h.engine.flush).toHaveBeenCalledTimes(1);
    expect(h.flushReceiptQueue).toHaveBeenCalledTimes(1);
  });

  it('flushes when a connection comes back, and not when it drops', async () => {
    signIn('alice');
    mount();
    await settle();
    h.engine.flush.mockClear();

    const onNetwork = h.networkListeners[0]!;
    onNetwork({ isConnected: false });
    expect(h.engine.flush).not.toHaveBeenCalled();
    onNetwork({ isConnected: true });
    await settle();
    expect(h.engine.flush).toHaveBeenCalledTimes(1);
  });

  it('removes both listeners on unmount', () => {
    signIn('alice');
    const rendered = mount();
    rendered.unmount();
    expect(h.appStateRemoved).toHaveBeenCalledTimes(1);
    expect(h.networkRemoved).toHaveBeenCalledTimes(1);
    expect(h.engine.subscriberCount()).toBe(0);
  });
});

describe('SyncProvider — the value it provides', () => {
  it('mirrors engine state and counts only work still in flight', () => {
    signIn('alice');
    const rendered = mount();
    expect(rendered.value().hasSynced).toBe(false);
    expect(rendered.lastSynced()).toBeNull();

    const pending = { clientMutationId: 'a' } as unknown as QueuedMutation;
    const refused = {
      clientMutationId: 'b',
      rejection: { code: 'forbidden' },
    } as unknown as QueuedMutation;
    h.engine.emit({
      status: 'syncing',
      queue: [pending, refused],
      lastSyncedAt: '2026-09-01T00:00:00Z',
    });

    expect(rendered.value().status).toBe('syncing');
    expect(rendered.value().hasSynced).toBe(true);
    expect(rendered.value().pendingCount).toBe(1);
    expect(rendered.lastSynced()).toBe('2026-09-01T00:00:00Z');
  });

  it('keeps the same value object when a poll changes only lastSyncedAt', () => {
    signIn('alice');
    const rendered = mount();
    h.engine.emit({ lastSyncedAt: '2026-09-01T00:00:00Z' });
    const before = rendered.value();
    h.engine.emit({ lastSyncedAt: '2026-09-01T00:00:30Z' });
    expect(rendered.value()).toBe(before);
    expect(rendered.lastSynced()).toBe('2026-09-01T00:00:30Z');
  });

  it('enqueues a mutation under a fresh id, or the one supplied', async () => {
    signIn('alice');
    const rendered = mount();
    const id = await rendered.value().mutate(MutationKind.PersonalUpsert, 'g1', { a: 1 });
    expect(id).toBe('uuid-1');
    expect(h.engine.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMutationId: 'uuid-1',
        kind: MutationKind.PersonalUpsert,
        groupId: 'g1',
        payload: { a: 1 },
      }),
    );
    expect(await rendered.value().mutate(MutationKind.PersonalUpsert, 'g1', {}, 'mine')).toBe(
      'mine',
    );
  });

  it('passes flush, retry, discard and forgetGroup through to the engine', async () => {
    signIn('alice');
    const rendered = mount();
    await rendered.value().flush(['g1']);
    await rendered.value().retry('m1');
    await rendered.value().discard('m2');
    await rendered.value().forgetGroup('g2');
    expect(h.engine.flush).toHaveBeenCalledWith({ groupIds: ['g1'] });
    expect(h.engine.retry).toHaveBeenCalledWith('m1');
    expect(h.engine.discard).toHaveBeenCalledWith('m2');
    expect(h.engine.forgetGroup).toHaveBeenCalledWith('g2');
  });
});

describe('useSync / useLastSyncedAt', () => {
  it('refuses to run outside the provider', () => {
    expect(() => renderHook(() => useSync())).toThrow(/inside SyncProvider/);
  });

  it('reads what the provider hands down', () => {
    signIn('alice');
    h.engine.emit({ lastSyncedAt: '2026-09-01T00:00:00Z' });
    const provider = mount();
    const outer = provider.result.current;
    const inner = outer.props.children as FakeElement;
    provide(contextOf(outer), outer.props.value);
    provide(contextOf(inner), inner.props.value);

    expect(renderHook(() => useSync()).result.current).toBe(provider.value());
    expect(renderHook(() => useLastSyncedAt()).result.current).toBe('2026-09-01T00:00:00Z');
  });
});

describe('drafts', () => {
  it('saves a draft 300ms after the last change, and only the last value', async () => {
    vi.useFakeTimers();
    const rendered = renderHook((value: { amount: string }) => useDraft('k', value), {
      amount: '1',
    });
    rendered.rerender({ amount: '12' });
    rendered.rerender({ amount: '123' });
    vi.advanceTimersByTime(299);
    expect(h.engine.saveDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.engine.saveDraft).toHaveBeenCalledTimes(1);
    expect(h.engine.saveDraft).toHaveBeenCalledWith('k', { amount: '123' });
  });

  it('does not reset the debounce when the same value is rebuilt', () => {
    vi.useFakeTimers();
    const rendered = renderHook((value: { amount: string }) => useDraft('k', value), {
      amount: '1',
    });
    vi.advanceTimersByTime(200);
    rendered.rerender({ amount: '1' });
    vi.advanceTimersByTime(100);
    expect(h.engine.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when disabled or when the value does not serialise', () => {
    vi.useFakeTimers();
    renderHook(() => useDraft('k', { a: 1 }, { enabled: false }));
    renderHook(() => useDraft('k', undefined));
    vi.advanceTimersByTime(1000);
    expect(h.engine.saveDraft).not.toHaveBeenCalled();
  });

  it('reports a draft the disk refused instead of throwing', async () => {
    vi.useFakeTimers();
    h.engine.saveDraft.mockRejectedValueOnce(new Error('busy'));
    renderHook(() => useDraft('k', { a: 1 }));
    vi.advanceTimersByTime(300);
    await settle();
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.saveDraft');
  });

  it('restores a saved draft once', async () => {
    h.engine.readDraft.mockResolvedValueOnce({ amount: '5' });
    const rendered = renderHook(() => useRestoredDraft<{ amount: string }>('k'));
    expect(rendered.result.current).toEqual({ draft: null, loading: true });
    await settle();
    expect(rendered.result.current).toEqual({ draft: { amount: '5' }, loading: false });
  });

  it('stops loading and reports when the read fails', async () => {
    h.engine.readDraft.mockRejectedValueOnce(new Error('read'));
    const rendered = renderHook(() => useRestoredDraft('k'));
    await settle();
    expect(rendered.result.current).toEqual({ draft: null, loading: false });
    expect(h.reportHandled).toHaveBeenCalledWith(expect.any(Error), 'sync.readDraft');
  });

  it('ignores a read that lands after unmount', async () => {
    h.engine.readDraft.mockResolvedValueOnce({ late: true });
    const rendered = renderHook(() => useRestoredDraft('k'));
    rendered.unmount();
    await settle();
    expect(rendered.result.current).toEqual({ draft: null, loading: true });
  });

  it('clearDraft delegates to the engine', async () => {
    await clearDraft('k');
    expect(h.engine.clearDraft).toHaveBeenCalledWith('k');
  });
});
