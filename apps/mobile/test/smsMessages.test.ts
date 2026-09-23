/**
 * The device-only message store, as something a screen renders.
 *
 * Module state rather than React state, so every mounted screen sees the same
 * rows — and rows from a previous account are never handed out, not even for
 * the frame between a sign-in and the read that follows it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredSms } from '@/lib/smsMessageTypes';

import type * as FakeReact from './support/fakeReact';

// The fake React instance rides along on the mocked module, so a test can reach
// the exact one the hook under test was given, whichever registry that was.
vi.mock('react', async () => {
  const fake = await import('./support/fakeReact');
  return { ...fake.reactModule(), __fake: fake };
});

const h = vi.hoisted(() => ({
  userId: 'alice' as string | null,
  load: vi.fn(async (_owner: string): Promise<StoredSms[]> => []),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: h.userId ? { user: { id: h.userId } } : null }),
}));
vi.mock('@/lib/smsMessageStore', () => ({ loadMessages: h.load }));

const rowFor = (owner: string, key: string) =>
  ({ dedupeKey: `${owner}:${key}` }) as unknown as StoredSms;

/** A fresh module, so the shared snapshot starts empty for every test. */
async function load() {
  vi.resetModules();
  const messages = await import('@/lib/smsMessages');
  const fake = ((await import('react')) as unknown as { __fake: typeof FakeReact }).__fake;
  return { ...fake, ...messages };
}

beforeEach(() => {
  h.userId = 'alice';
  h.load.mockReset();
  h.load.mockImplementation(async (owner) => [rowFor(owner, '1'), rowFor(owner, '2')]);
});

describe('useSmsMessages', () => {
  it('is loading and empty on mount, then shows the account’s rows', async () => {
    const { renderHook, flush, useSmsMessages } = await load();

    const view = renderHook(() => useSmsMessages());
    expect(view.result.current).toMatchObject({ rows: [], loading: true });

    await flush();

    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.rows.map((r) => r.dedupeKey)).toEqual(['alice:1', 'alice:2']);
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('reads the file once for two mounts, and not again on a re-render', async () => {
    const { renderHook, flush, useSmsMessages } = await load();

    const first = renderHook(() => useSmsMessages());
    const second = renderHook(() => useSmsMessages());
    await flush();
    first.rerender();
    await flush();

    expect(h.load).toHaveBeenCalledTimes(1);
    expect(second.result.current.rows).toHaveLength(2);
  });

  it('touches no file when the caller’s gate is shut, answering as an empty settled store', async () => {
    const { renderHook, flush, useSmsMessages } = await load();

    const view = renderHook(() => useSmsMessages(false));
    await flush();

    expect(h.load).not.toHaveBeenCalled();
    expect(view.result.current).toMatchObject({ rows: [], loading: false });
  });

  it('never shows the previous account’s rows after a switch', async () => {
    const { renderHook, flush, useSmsMessages } = await load();
    const view = renderHook(() => useSmsMessages());
    await flush();

    h.userId = 'bob';
    let release!: () => void;
    h.load.mockImplementationOnce(
      (owner) =>
        new Promise((resolve) => {
          release = () => resolve([rowFor(owner, '9')]);
        }),
    );
    view.rerender();

    expect(view.result.current).toMatchObject({ rows: [], loading: true });

    release();
    await flush();
    expect(view.result.current.rows.map((r) => r.dedupeKey)).toEqual(['bob:9']);
  });

  it('shows an empty, settled list when the store cannot be read', async () => {
    const { renderHook, flush, useSmsMessages } = await load();
    h.load.mockRejectedValueOnce(new Error('locked'));

    const view = renderHook(() => useSmsMessages());
    await flush();

    expect(view.result.current).toMatchObject({ rows: [], loading: false });
  });

  it('reloads on demand, and every mounted screen sees what the reload found', async () => {
    const { renderHook, flush, useSmsMessages } = await load();
    const view = renderHook(() => useSmsMessages());
    const other = renderHook(() => useSmsMessages());
    await flush();

    h.load.mockResolvedValueOnce([rowFor('alice', '3')]);
    await view.result.current.reload();
    await flush();

    expect(other.result.current.rows.map((r) => r.dedupeKey)).toEqual(['alice:3']);
    view.unmount();
    other.unmount();
  });

  it('publishes an empty store for a signed-out reload without reading anything', async () => {
    const { reloadMessages } = await load();
    await reloadMessages('');
    expect(h.load).not.toHaveBeenCalled();
  });
});
