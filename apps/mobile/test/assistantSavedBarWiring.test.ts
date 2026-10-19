/**
 * The saved bar wired into the follow-up card (WS2): the controls the bar is
 * given, the undo window, hand-offs that can be undone, and typed answers that
 * are read on the phone before the agent is asked. Same shallow fakeReact
 * harness as voiceFollowUps.test.ts.
 */

import { decodeLoan, decodeTxn } from '@waves/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VoiceFollowUps,
  type SavedBarControls,
  type SavedBarContext,
} from '../src/components/VoiceFollowUps';
import { UNDO_RING_MS } from '../src/lib/assistantUndo';
import type { SavedState } from '../src/lib/followUpApply';
import type { AgentExpenseWrite, AgentLocalData } from '../src/lib/voiceAgentPlan';
import { act, findAll, flush, renderHook, textOf, type FakeElement } from './support/fakeReact';

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('react/jsx-runtime', async () => (await import('./support/fakeReact')).jsxModule());

const world = vi.hoisted(() => ({
  place: null as null | {
    lat: number;
    lng: number;
    name: string | null;
    countryCode: string | null;
  },
  placeGate: null as null | Promise<void>,
  online: true,
  upsert: vi.fn(async (_input: unknown) => 'rec'),
  removePersonal: vi.fn(async (_id: string) => 'id'),
  writeExpense: vi.fn(async (_input: unknown) => 'id'),
  removeExpense: vi.fn(async (_id: string) => undefined),
  push: vi.fn(),
  toast: vi.fn(),
  send: vi.fn(),
  txns: [] as unknown[],
  groups: [] as unknown[],
  expenses: [] as unknown[],
  prefsNow: null as null | { prefs: unknown; update: (c: (p: never) => never) => void },
  initialPrefs: null as unknown,
}));

vi.mock('react-native', () => ({
  View: 'View',
  Pressable: 'Pressable',
  Platform: { OS: 'android' },
}));
vi.mock('expo-localization', () => ({ getLocales: () => [] }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
vi.mock('@waves/ui', () => {
  const deep = (): unknown =>
    new Proxy(() => 0, { get: (_t, key) => (key === Symbol.toPrimitive ? () => 8 : deep()) });
  return {
    Button: 'Button',
    Text: 'Text',
    iconSize: { base: 16 },
    useTheme: () => deep(),
  };
});
vi.mock('@/components/VoiceTypedAnswer', () => ({ VoiceTypedAnswer: 'VoiceTypedAnswer' }));
vi.mock('@/data/hooks', () => ({
  useWriteExpense: () => ({ mutateAsync: world.writeExpense }),
  useDeleteExpense: () => ({ mutateAsync: world.removeExpense }),
  useOpenReceipts: () => ({ data: [], loading: false }),
}));
vi.mock('@/data/groupRecurring', () => ({
  useCreateGroupRecurring: () => ({ mutateAsync: async () => 'rule' }),
}));
vi.mock('@/data/personal', () => ({
  usePersonalLedger: () => ({ txns: world.txns, recurrings: [], loans: [], budgets: [] }),
  useUpsertPersonalRecord: () => ({ mutateAsync: world.upsert }),
  useDeletePersonalRecord: () => ({ mutateAsync: world.removePersonal }),
}));
vi.mock('@/i18n', async () => {
  const actual = await vi.importActual<typeof import('../src/i18n')>('../src/i18n');
  return {
    ...actual,
    useStrings: () => ({ t: actual.STRINGS_BY_LANGUAGE.en, locale: 'en-IN', language: 'en' }),
  };
});
vi.mock('@/lib/auth', () => ({ useViewerId: () => 'u1' }));
vi.mock('@/lib/followUpPrefs', async () => {
  const { useState } = await import('react');
  const core = await import('@waves/core');
  return {
    useFollowUpPrefs: () => {
      const [prefs, set] = useState((world.initialPrefs as never) ?? core.DEFAULT_PREFS);
      const handle = {
        ready: true,
        prefs,
        update: (change: (p: never) => never) => set((p: never) => change(p)),
      };
      world.prefsNow = handle as never;
      return handle;
    },
  };
});
vi.mock('@/lib/location', () => ({
  currentPlaceIfGranted: async () => {
    if (world.placeGate) await world.placeGate;
    return world.place;
  },
}));
vi.mock('@/lib/navigation', () => ({ router: { push: world.push } }));
vi.mock('@/lib/toast', () => ({ useToast: () => ({ show: world.toast }) }));
vi.mock('@/lib/voiceAgent', () => ({ sendVoiceTranscript: world.send }));
vi.mock('@/lib/voiceStream', () => ({ checkOnline: async () => world.online }));
vi.mock('@/sync', () => ({ useSync: () => ({ mirror: {}, queue: {} }) }));
vi.mock('@waves/core', async (original) => ({
  ...(await original<typeof import('@waves/core')>()),
  materialiseGroups: () => world.groups,
  materialiseMembers: (_m: unknown, _q: unknown, o: { groupId: string }) =>
    (world.groups as { id: string; _members: unknown[] }[]).find((g) => g.id === o.groupId)
      ?._members ?? [],
  materialiseExpenses: () => world.expenses,
}));

const TODAY = '2026-10-21';

const personal = (over: Partial<SavedState> = {}): SavedState => ({
  kind: 'personal',
  id: 'p1',
  groupId: null,
  description: 'shoes',
  amount: 800000n,
  currency: 'INR',
  category: 'shopping',
  categoryStated: true,
  date: TODAY,
  notes: null,
  place: null,
  location: null,
  paymentMethod: 'cash',
  payers: null,
  hasReceipt: false,
  reimbursable: false,
  participants: [],
  ...over,
});
const group = (over: Partial<SavedState> = {}): SavedState =>
  personal({
    kind: 'group',
    id: 'g-e1',
    groupId: 'g1',
    payers: { m1: 800000n },
    participants: ['m1', 'm2'],
    ...over,
  });
const write: AgentExpenseWrite = {
  expenseId: 'g-e1',
  description: 'dinner',
  category: 'food',
  expenseDate: TODAY,
  currency: 'INR',
  amount: 800000n,
  splitParams: { kind: 'equal' },
  participants: ['m1', 'm2'],
  payers: { m1: 800000n },
  expectedShares: { m1: 400000n, m2: 400000n },
};
const local: AgentLocalData = {
  groups: [
    {
      id: 'g1',
      name: 'Goa trip',
      currency: 'INR',
      members: [
        { id: 'm1', name: 'Me', isViewer: true, avatarUrl: null },
        { id: 'm2', name: 'Ravi', isViewer: false, avatarUrl: null },
        { id: 'm3', name: 'Priya', isViewer: false, avatarUrl: null },
      ],
    },
  ],
};

const onClose = vi.fn();
function mount(initial: SavedState, groupWrite: AgentExpenseWrite | null = null, extra = {}) {
  return renderHook(() =>
    VoiceFollowUps({ initial, groupWrite, local, today: TODAY, onClose, ...extra }),
  );
}
const tree = (r: ReturnType<typeof mount>) => r.result.current;
const byLabel = (r: ReturnType<typeof mount>, label: string): FakeElement | undefined =>
  findAll(tree(r), (n) => n.props.accessibilityLabel === label || n.props.label === label)[0];
const press = async (r: ReturnType<typeof mount>, label: string): Promise<void> => {
  const node = byLabel(r, label);
  if (!node) throw new Error(`no control "${label}" in: ${textOf(tree(r))}`);
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await flush();
};
const labels = (r: ReturnType<typeof mount>): string[] =>
  findAll(
    tree(r),
    (n) => n.type === 'Pressable' || n.type === 'Button' || typeof n.type === 'function',
  ).map((n) => String(n.props.accessibilityLabel ?? n.props.label));

beforeEach(() => {
  vi.clearAllMocks();
  // The clock is part of the scorer (a spend after midnight asks about the date),
  // so the tests pin it to mid-afternoon on the day they are written for.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 21, 15, 0, 0));
  world.place = null;
  world.placeGate = null;
  world.online = true;
  world.txns = [];
  world.groups = [];
  world.expenses = [];
  world.initialPrefs = null;
  world.upsert.mockImplementation(async () => 'rec');
});
afterEach(() => vi.useRealTimers());

const withHere = () => {
  world.place = { lat: 12.9, lng: 77.6, name: 'Blue Tokai', countryCode: 'IN' };
  world.txns = [
    {
      id: 'old',
      kind: 'expense',
      amount: 500000n,
      currency: 'INR',
      category: 'food',
      note: 'lunch',
      date: '2026-10-01',
      place: 'Phoenix Mall',
    },
  ];
};

describe('saved bar controls', () => {
  function barMount(initial: SavedState, extra = {}) {
    let context: SavedBarContext | null = null;
    const r = mount(initial, null, {
      renderSavedBar: (c: SavedBarContext) => {
        context = c;
        return { type: 'SavedBar', props: { headline: c.headline }, key: null };
      },
      ...extra,
    });
    return {
      r,
      controls: (): SavedBarControls => (context as unknown as SavedBarContext).controls,
    };
  }

  it('MC-SB-03 the bar replaces the plain headline and is given controls', async () => {
    const { r, controls } = barMount(personal());
    await flush();
    expect(findAll(tree(r), (n) => n.type === 'SavedBar')).toHaveLength(1);
    expect(
      findAll(tree(r), (n) => n.type === 'Text' && textOf(n) === 'Added ₹8,000.00 to Personal ✓'),
    ).toHaveLength(0);
    expect(Object.keys(controls()).sort()).toEqual([
      'addFilled',
      'hold',
      'popFilled',
      'replaceSaved',
      'stop',
    ]);
  });

  it('MC-SB-04 with a bar the empty "Saved" beat is the 6 s undo window, not 1.2 s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 15, 0, 0));
    barMount(personal({ amount: 5000n }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UNDO_RING_MS - 2000 + 100);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('MC-SB-05 using the bar holds the panel open: no auto-close, and a Done button', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 15, 0, 0));
    const { r, controls } = barMount(personal({ amount: 5000n }));
    await vi.advanceTimersByTimeAsync(10);
    await act(async () => controls().hold());
    await vi.advanceTimersByTimeAsync(UNDO_RING_MS + 1000);
    expect(onClose).not.toHaveBeenCalled();
    expect(byLabel(r, 'Done')).toBeDefined();
  });

  it('MC-SB-06 replaceSaved becomes the saved state, and onSavedStateChange hears of it', async () => {
    const seen: SavedState[] = [];
    const { controls } = barMount(personal(), {
      onSavedStateChange: (s: SavedState) => seen.push(s),
    });
    await flush();
    const next = personal({ amount: 80000n });
    await act(async () => controls().replaceSaved(next));
    expect(seen).toEqual([next]);
  });

  it('CR-27 addFilled and popFilled keep the closing line honest when an answer is undone', async () => {
    withHere();
    const { r, controls } = barMount(personal());
    await flush();
    await press(r, 'Blue Tokai');
    expect(textOf(tree(r))).toContain('Saved with place');
    await act(async () => controls().popFilled());
    await flush();
    expect(textOf(tree(r))).not.toContain('Saved with place');
    await act(async () => controls().addFilled(['payment']));
    await flush();
    expect(textOf(tree(r))).toContain('Saved with payment');
  });

  it('MC-SB-07 stop ends the questions', async () => {
    withHere();
    const { r, controls } = barMount(personal());
    await flush();
    expect(labels(r)).toContain('Skip');
    await act(async () => controls().stop());
    await flush();
    expect(labels(r)).not.toContain('Skip');
  });
});

describe('hand-offs that can be undone', () => {
  it('CR-28 a lend reports the loan it made so it can be taken back', async () => {
    world.upsert.mockImplementation(async () => 'loan-9');
    const onUndoable = vi.fn();
    const r = mount(
      personal({ description: 'gave 5000 to Ravi', amount: 500000n, category: 'other' }),
      null,
      { onUndoable },
    );
    await flush();
    await press(r, 'Yes, Ravi owes me');
    const loan = world.upsert.mock.calls.find(
      (c) => (c[0] as { recordKind: string }).recordKind === 'loan',
    )![0] as { data: Record<string, unknown> };
    expect(decodeLoan('l', loan.data).principal).toBe(500000n);
    expect(onUndoable).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'lend',
        loanId: 'loan-9',
        previous: expect.objectContaining({ id: 'p1' }),
      }),
    );
  });

  it('CR-28b removing my copy of a duplicate reports it so it can be restored', async () => {
    const onUndoable = vi.fn();
    world.groups = [
      {
        id: 'g1',
        name: 'Goa trip',
        type: 'trip',
        start_date: null,
        end_date: null,
        archived_at: null,
        _members: [
          {
            id: 'm1',
            left_at: null,
            profile: { display_name: 'Me' },
            profile_id: 'u1',
            ghost_name: null,
          },
          {
            id: 'm2',
            left_at: null,
            profile: { display_name: 'Anu' },
            profile_id: 'u2',
            ghost_name: null,
          },
        ],
      },
    ];
    world.expenses = [
      {
        id: 'x9',
        deleted_at: null,
        created_at: new Date(Date.now() - 3600_000).toISOString(),
        currentVersion: {
          author_member_id: 'm2',
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          amount: '121000',
          currency: 'INR',
          category: 'food',
          description: 'Dinner',
          expense_date: TODAY,
          location: null,
          shares: [{ member_id: 'm1' }, { member_id: 'm2' }],
        },
      },
    ];
    const r = mount(group({ amount: 120000n, category: 'food', description: 'dinner' }), write, {
      onUndoable,
    });
    await flush();
    await press(r, 'Same, remove mine');
    expect(world.removeExpense).toHaveBeenCalledWith('g-e1');
    expect(onUndoable).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'duplicate',
        previous: expect.objectContaining({ id: 'g-e1' }),
      }),
    );
  });
});

describe('typed answers are read on the phone first', () => {
  const typeInto = async (r: ReturnType<typeof mount>, text: string): Promise<void> => {
    await press(r, 'Type instead');
    const composer = findAll(tree(r), (n) => n.type === 'VoiceTypedAnswer')[0]!;
    await act(async () => {
      (composer.props.onSubmit as (t: string) => void)(text);
    });
    await flush();
  };

  it('MC-CR-01 typed "make it 800" makes no agent call and writes amount 80000', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    await typeInto(r, 'make it 800');
    expect(world.send).not.toHaveBeenCalled();
    const call = world.upsert.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(decodeTxn('p1', call.data).amount).toBe(80000n);
    expect(textOf(tree(r))).toContain('Changed to ₹800.00 ✓');
  });

  it('MC-CR-01b typed "it was yesterday" moves the date and says so', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    await typeInto(r, 'it was yesterday');
    expect(world.send).not.toHaveBeenCalled();
    expect(
      decodeTxn('p1', (world.upsert.mock.calls[0]![0] as { data: Record<string, unknown> }).data)
        .date,
    ).toBe('2026-10-20');
    expect(textOf(tree(r))).toMatch(/Dated .* ✓/);
  });

  it('MC-CR-02 typed "Phoenix Mall" (a place from the ledger) answers the place question', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    await typeInto(r, 'Phoenix Mall');
    expect(world.send).not.toHaveBeenCalled();
    expect(
      decodeTxn('p1', (world.upsert.mock.calls[0]![0] as { data: Record<string, unknown> }).data)
        .place,
    ).toBe('Phoenix Mall');
  });

  it('MC-CR-03 text the phone cannot read still goes to the agent', async () => {
    withHere();
    world.send.mockResolvedValue({ kind: 'error' });
    const r = mount(personal());
    await flush();
    await typeInto(r, 'the new place near the lake');
    expect(world.send).toHaveBeenCalledTimes(1);
  });

  it('MC-CR-04 a correction that changes nothing says so and writes nothing', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    await typeInto(r, 'make it 8000');
    expect(world.upsert).not.toHaveBeenCalled();
    expect(textOf(tree(r))).toContain('Nothing to change');
  });
});
