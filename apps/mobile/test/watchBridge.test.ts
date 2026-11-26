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
  place: null as { lat: number; lng: number; name: null } | null,
  phoneReads: 0,
  fileHandler: null as ((event: unknown) => void) | null,
  transcript: '500 rupees tea' as string | null,
  deleted: [] as string[],
  locationGranted: false,
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
  onWatchFile: (handler: (event: unknown) => void) => {
    h.fileHandler = handler;
    return () => undefined;
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
  useVoiceAgentStatus: () => ({ enabled: false, ready: true, lastKnown: false }),
}));
vi.mock('@/lib/watch/voiceClip', () => ({
  agentCall: () => async () => ({ kind: 'error' }),
  deleteClip: (uri: string) => {
    h.deleted.push(uri);
  },
  readClipBase64: async () => '',
  sweepStaleClips: () => undefined,
  transcribeFile: async () => h.transcript,
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
vi.mock('@/lib/location', () => ({
  captureLocationIfGranted: async () => {
    h.phoneReads += 1;
    return h.place;
  },
  locationAvailable: () => true,
  locationPermission: async () => (h.locationGranted ? 'granted' : 'denied'),
  LocationPermission: { Granted: 'granted', Denied: 'denied', Undetermined: 'undetermined' },
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
  h.place = null;
  h.phoneReads = 0;
  h.locationGranted = false;
  h.fileHandler = null;
  h.transcript = '500 rupees tea';
  h.deleted = [];
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

  it('sends the settings and the recent list on mount', async () => {
    h.count = 3;
    h.currency = 'AED';
    renderHook(() => WatchBridgeProvider({}));
    await settle();
    expect(sentOf('settings')).toEqual([
      { t: 'settings', recentCount: 3, currency: 'AED', locationEnabled: false },
    ]);
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
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: true, id: 'intent-1' }]);
    });

    it.each([
      ['INR', '500', 50000n],
      ['JPY', '500', 500n],
      ['KWD', '5', 5000n],
    ])('books a dialled whole-unit amount in %s minor units', async (currency, amount, minor) => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'i1', amount, currency, note: '' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ amount: minor }));
    });

    it.each([
      ['INR', 50000n],
      ['JPY', 500n],
      ['KWD', 500000n],
    ])('rescales an already-installed watch (units x 100) for %s', async (currency, minor) => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'i1', amountMinor: '50000', currency, note: '' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ amount: minor }));
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
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: true, id: 'intent-2' }]);
    });

    it('attaches the place to a spoken expense, and saves without one when there is none', async () => {
      h.place = { lat: 12.9, lng: 77.6, name: null };
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'voiceAdd', id: 'loc-1', transcript: '500 rupees tea' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ location: { lat: 12.9, lng: 77.6, name: null } }),
      );
      h.mutateAsync.mockClear();
      h.place = null;
      h.messageHandler!({ t: 'voiceAdd', id: 'loc-2', transcript: '500 rupees tea' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ location: null }));
    });

    it('books several spoken items as one expense, in the default currency', async () => {
      h.groups = undefined;
      h.currency = 'INR';
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'voiceAdd', id: 'intent-3', transcript: 'tea 50 and lunch 200' });
      await settle();
      const calls = h.mutateAsync.mock.calls.map(([input]) => input);
      expect(calls).toHaveLength(1);
      expect(calls[0].currency).toBe('INR');
      expect(calls[0].amount).toBe(25000n);
    });

    it('refuses a voice-add with no amount instead of booking a zero', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'voiceAdd', id: 'i', transcript: 'hello there' });
      await settle();
      expect(h.mutateAsync).not.toHaveBeenCalled();
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: false, error: 'no-amount', id: 'i' }]);
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
      await settle();
      h.sent = [];
      h.messageHandler!({ t: 'quickAdd', id: 'i', amountMinor: '0', currency: 'INR', note: '' });
      h.messageHandler!('garbage');
      await settle();
      expect(h.sent).toEqual([]);
      expect(h.mutateAsync).not.toHaveBeenCalled();
    });

    describe('a voice clip from the watch', () => {
      const MADE = Date.parse('2026-11-26T18:50:00Z');
      const clipEvent = (extra: Record<string, unknown> = {}) => ({
        uri: 'file:///cache/c1.m4a',
        metadata: { t: 'voiceClip', id: 'c1', durationMs: 4000, version: 1, ...extra },
      });

      it('files exactly one Review draft from the watch, with its transcript, time and place', async () => {
        renderHook(() => WatchBridgeProvider({}));
        h.fileHandler!(
          clipEvent({
            madeAt: MADE,
            tzOffsetMin: 330,
            location: { lat: 12.9, lng: 77.6, accuracy: 50 },
          }),
        );
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledTimes(1);
        expect(h.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            captureId: 'c1',
            amount: 50000n,
            rawText: '500 rupees tea',
            expenseDate: '2026-11-27',
            location: { lat: 12.9, lng: 77.6, name: null },
            parsed: expect.objectContaining({ source: 'watch', kind: 'voice', watchId: 'c1' }),
          }),
        );
        expect(sentOf('voiceResult')).toHaveLength(1);
      });

      it('does not file a resent clip twice', async () => {
        renderHook(() => WatchBridgeProvider({}));
        h.fileHandler!(clipEvent());
        await settle();
        h.fileHandler!(clipEvent());
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledTimes(1);
        // The duplicate's file is still cleaned up.
        expect(h.deleted).toEqual(['file:///cache/c1.m4a', 'file:///cache/c1.m4a']);
      });

      it('removes the clip file once it has been handled, and when it fails', async () => {
        renderHook(() => WatchBridgeProvider({}));
        h.fileHandler!(clipEvent());
        await settle();
        expect(h.deleted).toEqual(['file:///cache/c1.m4a']);
        h.deleted = [];
        h.mutateAsync.mockRejectedValueOnce(new Error('queue full'));
        h.fileHandler!({ ...clipEvent({ id: 'c2' }), uri: 'file:///cache/c2.m4a' });
        await settle();
        expect(h.deleted).toEqual(['file:///cache/c2.m4a']);
        expect(sentOf('voiceResult')[1]).toMatchObject({ id: 'c2', status: 'error' });
      });
    });

    describe('watch time and place', () => {
      const MADE = Date.parse('2026-11-26T18:50:00Z'); // 00:20 on the 27th in IST
      const quick = (extra: Record<string, unknown> = {}) => ({
        t: 'quickAdd',
        id: 'w1',
        amount: '100',
        currency: 'INR',
        note: '',
        ...extra,
      });

      it('books the day the watch made it, in the watch zone, even when delivered later', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(MADE + 9 * 3600_000); // delivered nine hours on
        renderHook(() => WatchBridgeProvider({}));
        h.messageHandler!(quick({ madeAt: MADE, tzOffsetMin: 330 }));
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ expenseDate: '2026-11-27' }),
        );
        h.mutateAsync.mockClear();
        h.messageHandler!(quick({ id: 'w2', madeAt: MADE, tzOffsetMin: -300 })); // New York
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ expenseDate: '2026-11-26' }),
        );
        vi.useRealTimers();
      });

      it('uses the watch location, and never reads the phone for it', async () => {
        h.place = { lat: 1, lng: 2, name: null };
        renderHook(() => WatchBridgeProvider({}));
        h.messageHandler!(quick({ location: { lat: 12.97, lng: 77.59, accuracy: 80 } }));
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ location: { lat: 12.97, lng: 77.59, name: null } }),
        );
        expect(h.phoneReads).toBe(0);
      });

      it('falls back to the phone only for a fresh add with no watch location', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(MADE + 60_000);
        h.place = { lat: 1, lng: 2, name: null };
        renderHook(() => WatchBridgeProvider({}));
        h.messageHandler!(quick({ madeAt: MADE }));
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ location: { lat: 1, lng: 2, name: null } }),
        );
        // Delivered hours later: the phone is not where the watch was.
        h.mutateAsync.mockClear();
        vi.setSystemTime(MADE + 3 * 3600_000);
        h.messageHandler!(quick({ id: 'w2', madeAt: MADE }));
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ location: null }));
        vi.useRealTimers();
      });

      it('treats an older watch (no time, no place) as made just now, as before', async () => {
        h.place = { lat: 1, lng: 2, name: null };
        renderHook(() => WatchBridgeProvider({}));
        h.messageHandler!(quick());
        await settle();
        expect(h.mutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({ location: { lat: 1, lng: 2, name: null } }),
        );
      });

      it('files a watch add as a Review draft marked as from the watch', async () => {
        renderHook(() => WatchBridgeProvider({}));
        h.messageHandler!(quick({ madeAt: MADE }));
        h.messageHandler!({ t: 'voiceAdd', id: 'v1', transcript: '500 rupees tea' });
        await settle();
        const parsed = h.mutateAsync.mock.calls.map(([input]) => input.parsed);
        expect(parsed[0]).toMatchObject({ source: 'watch', kind: 'quick', watchId: 'w1' });
        expect(parsed[1]).toMatchObject({ source: 'watch', kind: 'voice', watchId: 'v1' });
      });

      it('books a resent add under the same capture id, so the queue upserts it once', async () => {
        renderHook(() => WatchBridgeProvider({}));
        h.messageHandler!(quick({ madeAt: MADE }));
        h.messageHandler!(quick({ madeAt: MADE }));
        await settle();
        const ids = h.mutateAsync.mock.calls.map(([input]) => input.captureId);
        expect(ids).toEqual(['w1', 'w1']);
        expect(sentOf('ack')).toEqual([
          { t: 'ack', ok: true, id: 'w1' },
          { t: 'ack', ok: true, id: 'w1' },
        ]);
      });

      it('tells the watch whether location is on, and again whenever it asks', async () => {
        h.locationGranted = true;
        renderHook(() => WatchBridgeProvider({}));
        await settle();
        expect(sentOf('settings')[0]).toMatchObject({ locationEnabled: true });
        h.locationGranted = false;
        h.messageHandler!({ t: 'requestRecent', count: 5 });
        await settle();
        expect(sentOf('settings')[1]).toMatchObject({ locationEnabled: false });
      });
    });

    it('acks a failure when the write throws', async () => {
      h.mutateAsync.mockRejectedValueOnce(new Error('queue full'));
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'i', amountMinor: '100', currency: 'INR', note: 'x' });
      await settle();
      expect(sentOf('ack')).toEqual([{ t: 'ack', ok: false, error: 'failed', id: 'i' }]);
    });
  });
});
