/**
 * `WatchBridgeProvider` — where a tap on the wrist becomes a real write.
 *
 * The relay contract is tested in @waves/core and the voice parser has its own
 * suite (`watchVoiceExpense.test.ts`). This covers what the phone half decides:
 * a quick-add becomes a capture keyed by the watch's intent id (so a transport
 * retry is idempotent), a voice-add with no money on it is refused rather than
 * booked, the recent list is pushed only when it changed and only to a
 * reachable watch — unless the watch asked — and a list lost in transit is sent
 * again next time rather than being remembered as delivered.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRecentItems, WatchBridgeProvider } from '@/lib/watch/bridge';

import { renderHook } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());
vi.mock('react/jsx-dev-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const h = vi.hoisted(() => ({
  available: true,
  reachable: true,
  sendResult: true,
  sent: [] as Record<string, unknown>[],
  messageHandler: null as ((raw: unknown) => void) | null,
  failureHandler: null as ((kind: string | null) => void) | null,
  unsubscribed: vi.fn(),
  unsubscribedFailure: vi.fn(),
  mutateAsync: vi.fn(async (_input: Record<string, unknown>) => undefined),
  groups: [{ id: 'g1', name: 'Goa trip' }] as { id: string; name: string }[] | undefined,
  mirror: { tables: {} } as unknown,
  count: 5,
  session: { user: { id: 'me' } } as { user: { id: string } } | null,
  currency: 'INR',
  rows: [] as unknown[],
}));

vi.mock('@/lib/watch/nativeModule', () => ({
  watchAvailable: () => h.available,
  watchReachable: () => h.reachable,
  sendToWatch: (message: Record<string, unknown>) => {
    h.sent.push(message);
    return h.sendResult;
  },
  onWatchMessage: (handler: (raw: unknown) => void) => {
    h.messageHandler = handler;
    return h.unsubscribed;
  },
  onWatchSendFailed: (handler: (kind: string | null) => void) => {
    h.failureHandler = handler;
    return h.unsubscribedFailure;
  },
}));
vi.mock('@/data/hooks', () => ({
  useCreateCapture: () => ({ mutateAsync: h.mutateAsync }),
  useGroups: () => ({ data: h.groups }),
}));
vi.mock('@/data/recentActivity', () => ({
  recentActivity: (_mirror: unknown, _profile: unknown, limit: number) => h.rows.slice(0, limit),
}));
vi.mock('@/i18n', () => ({
  useStrings: () => ({
    t: { misc: { someone: 'Someone' }, captures: { unassigned: 'Personal' } },
    locale: 'en-IN',
  }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: h.session }) }));
vi.mock('@/lib/currency', () => ({ useDefaultCurrency: () => h.currency }));
vi.mock('@/lib/recentCount', () => ({ useRecentCount: () => ({ count: h.count }) }));
vi.mock('@/sync', () => ({ useSync: () => ({ mirror: h.mirror }) }));

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function activity(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    group_id: 'g1',
    actor_member_id: 'm1',
    actor: { profile_id: 'me', display_name: 'Me' },
    verb: 'added',
    object_type: 'expense',
    object_id: `e-${id}`,
    payload: { description: `Dinner ${id}`, amount: '120000', currency: 'INR' },
    created_at: '2026-09-23T10:00:00Z',
    group: { id: 'g1', name: 'Goa trip' },
    ...overrides,
  };
}

const sentOf = (t: string) => h.sent.filter((message) => message.t === t);

beforeEach(() => {
  vi.clearAllMocks();
  h.available = true;
  h.reachable = true;
  h.sendResult = true;
  h.sent = [];
  h.messageHandler = null;
  h.failureHandler = null;
  h.groups = [{ id: 'g1', name: 'Goa trip' }];
  h.mirror = { tables: {} };
  h.count = 5;
  h.session = { user: { id: 'me' } };
  h.currency = 'INR';
  h.rows = [activity('a1')];
});

describe('buildRecentItems', () => {
  const opts = {
    myProfileId: 'me',
    locale: 'en-IN',
    fallbackCurrency: 'INR',
    someoneLabel: 'Someone',
    personalLabel: 'Personal',
    now: Date.parse('2026-09-23T12:00:00Z'),
  };

  it('formats title, group, money and time on the phone, newest n only', () => {
    const rows = [activity('a1'), activity('a2'), activity('a3')];
    const items = buildRecentItems(rows as never, 2, opts);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toContain('Dinner a1');
    expect(items[0]!.subtitle).toBe('Goa trip');
    expect(items[0]!.amountText).toMatch(/1,200/);
    expect(items[0]!.whenText).not.toBe('');
  });

  it('labels a groupless row as personal and leaves out money it cannot read', () => {
    const [item] = buildRecentItems(
      [activity('a1', { group: null, payload: { description: 'Tea' } })] as never,
      5,
      opts,
    );
    expect(item!.subtitle).toBe('Personal');
    expect(item!.amountText).toBe('');
  });
});

describe('WatchBridgeProvider', () => {
  it('renders its children and nothing else', () => {
    const { result } = renderHook(() => WatchBridgeProvider({ children: 'app' }));
    expect((result.current as { props: { children: unknown } }).props.children).toBe('app');
    const empty = renderHook(() => WatchBridgeProvider({}));
    expect((empty.result.current as { props: { children: unknown } }).props.children).toBeNull();
  });

  it('is inert in a build with no watch transport', () => {
    h.available = false;
    renderHook(() => WatchBridgeProvider({}));
    expect(h.sent).toEqual([]);
    expect(h.messageHandler).toBeNull();
    expect(h.failureHandler).toBeNull();
  });

  it('sends the settings and the recent list on mount', () => {
    h.count = 3;
    h.currency = 'AED';
    renderHook(() => WatchBridgeProvider({}));
    expect(sentOf('settings')).toEqual([{ t: 'settings', recentCount: 3, currency: 'AED' }]);
    expect(sentOf('recent')).toHaveLength(1);
    expect((sentOf('recent')[0]!.items as unknown[]).length).toBe(1);
  });

  it('does not push to a watch that is not reachable', () => {
    h.reachable = false;
    renderHook(() => WatchBridgeProvider({}));
    expect(sentOf('recent')).toEqual([]);
  });

  it('pushes again only when the list actually changed', () => {
    const rendered = renderHook(() => WatchBridgeProvider({}));
    expect(sentOf('recent')).toHaveLength(1);

    // A sync tick that changed nothing the watch shows.
    h.mirror = { tables: {} };
    rendered.rerender();
    expect(sentOf('recent')).toHaveLength(1);

    h.rows = [activity('a2'), activity('a1')];
    h.mirror = { tables: {} };
    rendered.rerender();
    expect(sentOf('recent')).toHaveLength(2);
  });

  it('keeps a failed send eligible for the next push', () => {
    h.sendResult = false;
    const rendered = renderHook(() => WatchBridgeProvider({}));
    expect(sentOf('recent')).toHaveLength(1);
    h.sendResult = true;
    h.mirror = { tables: {} };
    rendered.rerender();
    expect(sentOf('recent')).toHaveLength(2);
  });

  it('re-sends an unchanged list after the transport reports it lost', () => {
    const rendered = renderHook(() => WatchBridgeProvider({}));
    h.failureHandler!('settings'); // some other payload: the cache stands
    h.mirror = { tables: {} };
    rendered.rerender();
    expect(sentOf('recent')).toHaveLength(1);

    h.failureHandler!('recent');
    h.mirror = { tables: {} };
    rendered.rerender();
    expect(sentOf('recent')).toHaveLength(2);

    h.failureHandler!(null); // unknown kind counts too
    h.mirror = { tables: {} };
    rendered.rerender();
    expect(sentOf('recent')).toHaveLength(3);
  });

  it('unsubscribes from the transport on unmount', () => {
    const rendered = renderHook(() => WatchBridgeProvider({}));
    rendered.unmount();
    expect(h.unsubscribed).toHaveBeenCalledTimes(1);
    expect(h.unsubscribedFailure).toHaveBeenCalledTimes(1);
  });

  describe('messages from the watch', () => {
    it('books a quick-add as a capture keyed by the intent id, then acks', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({
        t: 'quickAdd',
        id: 'intent-1',
        amountMinor: '25000',
        currency: 'INR',
        note: 'Chai',
      });
      await settle();

      expect(h.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: 'intent-1',
          amount: 25000n,
          currency: 'INR',
          description: 'Chai',
          rawText: 'Chai',
          expenseDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: true }]);
    });

    it('sends no raw text for a quick-add with no note', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'i', amountMinor: '100', currency: 'INR', note: '' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ rawText: null }));
    });

    it('books one spoken expense under the intent id', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'voiceAdd', id: 'intent-2', transcript: '500 rupees tea' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledTimes(1);
      expect(h.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: 'intent-2',
          amount: 50000n,
          rawText: '500 rupees tea',
        }),
      );
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: true }]);
    });

    it('books several spoken expenses with ids of their own, in the default currency', async () => {
      h.groups = undefined;
      h.currency = 'INR';
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'voiceAdd', id: 'intent-3', transcript: 'tea 50 and lunch 200' });
      await settle();
      const calls = h.mutateAsync.mock.calls.map(([input]) => input);
      expect(calls.length).toBeGreaterThan(1);
      for (const call of calls) {
        expect(call.captureId).toBeUndefined();
        expect(call.currency).toBe('INR');
      }
    });

    it('refuses a voice-add with no amount instead of booking a zero', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'voiceAdd', id: 'i', transcript: 'hello there' });
      await settle();
      expect(h.mutateAsync).not.toHaveBeenCalled();
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: false, error: 'no-amount' }]);
    });

    it('answers a request for the list even when it is unchanged, and clamps the count', async () => {
      h.reachable = false; // an ask is answered regardless
      h.rows = [activity('a1'), activity('a2'), activity('a3'), activity('a4')];
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'requestRecent', count: 3 });
      h.messageHandler!({ t: 'requestRecent', count: 3 });
      await settle();
      const lists = sentOf('recent');
      expect(lists).toHaveLength(2);
      expect((lists[0]!.items as unknown[]).length).toBe(3);
    });

    it('acknowledges a notification action as unsupported for now', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'notifAction', actionId: 'a', objectId: 'o' });
      await settle();
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: false, error: 'unsupported' }]);
    });

    it('ignores a malformed message', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.sent = [];
      h.messageHandler!({ t: 'quickAdd', id: 'i', amountMinor: '0', currency: 'INR', note: '' });
      h.messageHandler!('garbage');
      await settle();
      expect(h.sent).toEqual([]);
      expect(h.mutateAsync).not.toHaveBeenCalled();
    });

    it('acks a failure when the write throws', async () => {
      h.mutateAsync.mockRejectedValueOnce(new Error('queue full'));
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'i', amountMinor: '100', currency: 'INR', note: 'x' });
      await settle();
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: false, error: 'failed' }]);
    });
  });
});
