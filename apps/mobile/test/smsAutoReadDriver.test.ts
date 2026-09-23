/**
 * The automatic reader's driver (`smsAutoRead.ts`): when it reads, when it
 * tears the background job down, and when it changes nothing at all.
 *
 * `smsAutoRead.test.ts` pins the window a pass asks for; this pins the
 * triggers. The three verdicts are handled differently on purpose: `'off'`
 * tears down, `'on'` arms and reads, `'unknown'` acts only on the last verdict
 * actually reached — a network having a bad minute is not a decision.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FakeReact from './support/fakeReact';

vi.mock('react', async () => {
  const fake = await import('./support/fakeReact');
  return { ...fake.reactModule(), __fake: fake };
});

type Outcome = { read: boolean; backfill: boolean; written: number; checkedAt: string | null };

const h = vi.hoisted(() => ({
  userId: 'alice' as string | null,
  authLoading: false,
  verdict: 'on' as 'on' | 'off' | 'unknown',
  gatesOpen: true,
  lastChecked: new Map<string, string | null>(),
  armed: null as string | null,
  wanted: true,
  appState: new Set<(state: string) => void>(),
  grant: new Set<() => void>(),
  run: vi.fn(),
  syncTask: vi.fn(async (_enabled: boolean) => {}),
  syncSchedule: vi.fn(async (_wanted: boolean) => {}),
  arm: vi.fn(async (_owner: string) => {}),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_type: string, listener: (state: string) => void) => {
      h.appState.add(listener);
      return { remove: () => h.appState.delete(listener) };
    },
  },
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    session: h.userId ? { user: { id: h.userId } } : null,
    loading: h.authLoading,
  }),
}));
vi.mock('@/lib/smsFeature', () => ({ useSmsInboxReaderVerdict: () => h.verdict }));
vi.mock('@/lib/smsAutoReadRun', () => ({
  deviceGatesOpen: async () => h.gatesOpen,
  runAutoReadFor: h.run,
}));
vi.mock('@/lib/smsAutoReadStore', () => ({
  armAutoRead: h.arm,
  backgroundCheckWanted: async () => h.wanted,
  loadArmedOwner: async () => h.armed,
  loadLastCheckedAt: async (owner: string) => h.lastChecked.get(owner) ?? null,
  onSmsPermissionGranted: (listener: () => void) => {
    h.grant.add(listener);
    return () => h.grant.delete(listener);
  },
}));
vi.mock('@/lib/smsAutoReadTask', () => ({
  syncAutoReadTask: h.syncTask,
  syncAutoReadSchedule: h.syncSchedule,
}));

const T0 = new Date('2026-03-10T09:00:00.000Z').getTime();

async function load() {
  vi.resetModules();
  const driver = await import('@/lib/smsAutoRead');
  const fake = ((await import('react')) as unknown as { __fake: typeof FakeReact }).__fake;
  return { ...fake, ...driver };
}

/** Let the serialised evaluation queue and the pass it starts run through. */
const settle = async (fake: typeof FakeReact) => {
  await fake.flush(20);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  h.userId = 'alice';
  h.authLoading = false;
  h.verdict = 'on';
  h.gatesOpen = true;
  h.lastChecked.clear();
  h.armed = null;
  h.wanted = true;
  h.appState.clear();
  h.grant.clear();
  h.run.mockReset();
  h.run.mockImplementation(async (): Promise<Outcome> => ({
    read: true,
    backfill: false,
    written: 1,
    checkedAt: new Date(Date.now()).toISOString(),
  }));
  h.syncTask.mockClear();
  h.syncSchedule.mockClear();
  h.arm.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the driver on launch', () => {
  it('arms, schedules and backfills the first time every gate passes', async () => {
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(h.arm).toHaveBeenCalledWith('alice');
    expect(h.syncSchedule).toHaveBeenCalledWith(true);
    expect(h.run).toHaveBeenCalledWith('alice');
    expect(view.result.current).toMatchObject({
      enabled: true,
      checking: false,
      lastCheckedAt: '2026-03-10T09:00:00.000Z',
    });
  });

  it('leaves the hourly job off when the person turned it off, and still reads', async () => {
    h.wanted = false;
    const m = await load();
    m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(h.syncSchedule).toHaveBeenCalledWith(false);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all while the session is still being restored', async () => {
    h.authLoading = true;
    const m = await load();
    m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(h.syncTask).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
    expect(h.appState.size).toBe(0);
  });

  it('tears the job down when the flag says off, or there is nobody signed in', async () => {
    h.verdict = 'off';
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(h.syncTask).toHaveBeenCalledWith(false);
    expect(h.run).not.toHaveBeenCalled();
    expect(view.result.current.enabled).toBe(false);

    h.verdict = 'on';
    h.userId = null;
    h.syncTask.mockClear();
    view.rerender();
    await settle(m);
    expect(h.syncTask).toHaveBeenCalledWith(false);
  });

  it('tears down on a revoked permission even while the flag is unknown, keeping the clock on screen', async () => {
    h.verdict = 'unknown';
    h.gatesOpen = false;
    h.lastChecked.set('alice', '2026-03-09T09:00:00.000Z');
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(h.syncTask).toHaveBeenCalledWith(false);
    expect(h.run).not.toHaveBeenCalled();
    expect(view.result.current).toMatchObject({
      enabled: false,
      lastCheckedAt: '2026-03-09T09:00:00.000Z',
    });
  });

  it('acts on the last verdict reached while the flag is unknown, scheduling nothing', async () => {
    h.verdict = 'unknown';
    h.armed = 'alice';
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(view.result.current.enabled).toBe(true);
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.syncTask).not.toHaveBeenCalled();
    expect(h.syncSchedule).not.toHaveBeenCalled();
  });

  it('stays off while unknown if this account was never armed', async () => {
    h.verdict = 'unknown';
    h.armed = 'bob';
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(view.result.current.enabled).toBe(false);
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe('what a failed read shows', () => {
  it('keeps the stored clock rather than claiming a read that failed', async () => {
    h.lastChecked.set('alice', '2026-03-09T09:00:00.000Z');
    h.run.mockResolvedValue({ read: false, backfill: false, written: 0, checkedAt: null });
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    // An ordinary (non-backfill) launch still reads: nothing has run in this process.
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(view.result.current.lastCheckedAt).toBe('2026-03-09T09:00:00.000Z');
    expect(view.result.current.checking).toBe(false);
  });

  it('survives a pass that throws, and is no longer checking afterwards', async () => {
    h.run.mockRejectedValue(new Error('belt and braces'));
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    expect(view.result.current.checking).toBe(false);
  });
});

describe('coming back to the app', () => {
  it('reads again after the quiet window, not within it', async () => {
    h.lastChecked.set('alice', '2026-03-09T09:00:00.000Z');
    const m = await load();
    m.renderHook(() => m.useSmsAutoRead());
    await settle(m);
    expect(h.run).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + m.QUIET_MS - 1000);
    for (const listener of h.appState) listener('active');
    await settle(m);
    expect(h.run).toHaveBeenCalledTimes(1);

    for (const listener of h.appState) listener('background');
    vi.setSystemTime(T0 + m.QUIET_MS + 1000);
    for (const listener of h.appState) listener('active');
    await settle(m);
    expect(h.run).toHaveBeenCalledTimes(2);
  });

  it('stops listening once unmounted', async () => {
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);
    expect(h.appState.size).toBe(1);
    expect(h.grant.size).toBe(1);

    view.unmount();

    expect(h.appState.size).toBe(0);
    expect(h.grant.size).toBe(0);
  });

  it('re-evaluates the moment the permission is granted', async () => {
    h.gatesOpen = false;
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);
    expect(view.result.current.enabled).toBe(false);

    h.gatesOpen = true;
    for (const listener of h.grant) listener();
    await settle(m);

    expect(view.result.current.enabled).toBe(true);
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});

describe('refresh', () => {
  it('reads now, past the quiet window, when the reader is live', async () => {
    h.lastChecked.set('alice', '2026-03-09T09:00:00.000Z');
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    await view.result.current.refresh();
    expect(h.run).toHaveBeenCalledTimes(2);
  });

  it('shares one pass between callers while it is in flight', async () => {
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);
    h.run.mockClear();

    let release!: () => void;
    h.run.mockImplementationOnce(
      () =>
        new Promise<Outcome>((resolve) => {
          release = () =>
            resolve({
              read: true,
              backfill: false,
              written: 0,
              checkedAt: '2026-03-10T10:00:00.000Z',
            });
        }),
    );
    const first = view.result.current.refresh();
    const second = view.result.current.refresh();
    expect(view.result.current.checking).toBe(true);

    release();
    await Promise.all([first, second]);
    await settle(m);

    expect(h.run).toHaveBeenCalledTimes(1);
    expect(view.result.current).toMatchObject({
      checking: false,
      lastCheckedAt: '2026-03-10T10:00:00.000Z',
    });
  });

  it('does nothing when the reader is off', async () => {
    h.verdict = 'off';
    const m = await load();
    const view = m.renderHook(() => m.useSmsAutoRead());
    await settle(m);

    await view.result.current.refresh();
    expect(h.run).not.toHaveBeenCalled();
  });
});

describe('SmsAutoRead', () => {
  it('drives the reader and renders nothing', async () => {
    const m = await load();
    const view = m.renderHook(() => m.SmsAutoRead());
    await settle(m);

    expect(view.result.current).toBeNull();
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});
