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
  fileHandler: null as ((event: { uri: string; metadata: unknown }) => void) | null,
  appState: 'active' as string,
  stateListener: null as ((state: string) => void) | null,
  deleted: [] as string[],
  transcribe: vi.fn(async (_uri: string): Promise<string | null> => null),
  failureHandler: null as ((kind: string | null) => void) | null,
  unsubscribed: vi.fn(),
  unsubscribedFailure: vi.fn(),
  place: null as { lat: number; lng: number; name: null } | null,
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
  onWatchFile: (handler: (event: { uri: string; metadata: unknown }) => void) => {
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
  transcribeFile: (uri: string) => h.transcribe(uri),
}));
vi.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return h.appState;
    },
    addEventListener: (_event: string, handler: (state: string) => void) => {
      h.stateListener = handler;
      return { remove: () => undefined };
    },
  },
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
vi.mock('@/lib/location', () => ({ captureLocationIfGranted: async () => h.place }));
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
  h.fileHandler = null;
  h.appState = 'active';
  h.stateListener = null;
  h.deleted = [];
  h.transcribe.mockReset();
  h.transcribe.mockResolvedValue(null);
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

    it.each([
      ['INR', '500', 50000n],
      ['JPY', '500', 500n],
      ['KWD', '5', 5000n],
    ])('books a dialled whole-unit amount in %s minor units', async (currency, amount, minor) => {
      h.currency = currency;
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
      h.currency = currency;
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'i1', amountMinor: '50000', currency, note: '' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ amount: minor }));
    });

    it('books a stale USD watch add in the phone default, rescaled (X2)', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'x2', amount: '45', currency: 'USD', note: '' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'INR', amount: 4500n }),
      );
    });

    it('rescales to the phone currency exponent when overriding (KWD phone, USD watch)', async () => {
      h.currency = 'KWD';
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({ t: 'quickAdd', id: 'x2k', amount: '5', currency: 'USD', note: '' });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'KWD', amount: 5000n }),
      );
    });

    it('trusts the watch currency once it confirms the phone settings', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.messageHandler!({
        t: 'quickAdd',
        id: 'c1',
        amount: '45',
        currency: 'USD',
        confirmedCurrency: 'INR',
        note: '',
      });
      await settle();
      expect(h.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD', amount: 4500n }),
      );
    });

    it('resends settings whenever the watch sends anything', async () => {
      renderHook(() => WatchBridgeProvider({}));
      h.sent = [];
      h.messageHandler!({ t: 'requestRecent', count: 5 });
      await settle();
      expect(sentOf('settings')).toEqual([{ t: 'settings', recentCount: 5, currency: 'INR' }]);
      h.messageHandler!({ t: 'quickAdd', id: 's2', amount: '1', currency: 'USD', note: '' });
      await settle();
      expect(sentOf('settings')).toHaveLength(2);
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

describe('voice clips from the watch', () => {
  const clip = (id: string) => ({
    uri: `file:///c/${id}.m4a`,
    metadata: { t: 'voiceClip', id, durationMs: 3000 },
  });
  const results = () => sentOf('voiceResult');

  it('answers added when the transcript has an amount', async () => {
    h.transcribe.mockResolvedValue('500 rupees tea');
    renderHook(() => WatchBridgeProvider({}));
    h.fileHandler!(clip('v1'));
    await settle();
    expect(h.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ captureId: 'v1', amount: 50000n }),
    );
    expect(results()).toEqual([expect.objectContaining({ id: 'v1', status: 'added' })]);
    expect(h.deleted).toContain('file:///c/v1.m4a');
  });

  it.each([
    ['silent transcript', ''],
    ['recogniser could not run', null],
    ['no amount spoken', 'hello there'],
  ])('answers error (not silence) for %s', async (_name, transcript) => {
    h.transcribe.mockResolvedValue(transcript as string | null);
    renderHook(() => WatchBridgeProvider({}));
    h.fileHandler!(clip('v2'));
    await settle();
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(results()).toEqual([expect.objectContaining({ id: 'v2', status: 'error' })]);
  });

  it('answers error when the transcription throws', async () => {
    h.transcribe.mockRejectedValue(new Error('boom'));
    renderHook(() => WatchBridgeProvider({}));
    h.fileHandler!(clip('v3'));
    await settle();
    expect(results()).toEqual([expect.objectContaining({ id: 'v3', status: 'error' })]);
  });

  it('answers error when saving fails (no session)', async () => {
    h.transcribe.mockResolvedValue('500 rupees tea');
    h.mutateAsync.mockRejectedValueOnce(new Error('no session'));
    renderHook(() => WatchBridgeProvider({}));
    h.fileHandler!(clip('v4'));
    await settle();
    expect(results()).toEqual([
      expect.objectContaining({ id: 'v4', status: 'error', error: 'failed' }),
    ]);
  });

  it('answers error when recognition never finishes', async () => {
    vi.useFakeTimers();
    try {
      h.transcribe.mockImplementation(() => new Promise(() => undefined));
      renderHook(() => WatchBridgeProvider({}));
      h.fileHandler!(clip('v5'));
      await vi.advanceTimersByTimeAsync(95_000);
      expect(results()).toEqual([expect.objectContaining({ id: 'v5', status: 'error' })]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds a clip received in the background and processes it on foreground', async () => {
    h.appState = 'background';
    h.transcribe.mockResolvedValue('500 rupees tea');
    renderHook(() => WatchBridgeProvider({}));
    h.fileHandler!(clip('v6'));
    await settle();
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(results()).toEqual([]);
    h.appState = 'active';
    h.stateListener!('active');
    await settle();
    expect(results()).toEqual([expect.objectContaining({ id: 'v6', status: 'added' })]);
  });

  it('re-sends the answer for a redelivered clip without saving twice', async () => {
    h.transcribe.mockResolvedValue('500 rupees tea');
    renderHook(() => WatchBridgeProvider({}));
    h.fileHandler!(clip('v7'));
    await settle();
    h.fileHandler!(clip('v7'));
    await settle();
    expect(h.mutateAsync).toHaveBeenCalledTimes(1);
    expect(results()).toHaveLength(2);
  });
});
