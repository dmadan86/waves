/**
 * MC-FU-01..15: the follow-up card, driven through fakeReact (shallow: JSX is
 * inert objects, effects and state run). The scorer's own rules are covered in
 * core; this file pins what the card does with them — what it shows, what each
 * tap writes, and when it stops.
 */

import { decodeLoan, decodeRecurring, decodeTxn, nextMonthlyDate } from '@waves/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoiceFollowUps, questionReason, questionText } from '../src/components/VoiceFollowUps';
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

describe('VoiceFollowUps', () => {
  it('MC-FU-01 a place question shows the place chips, Somewhere else, and the four links', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    expect(labels(r)).toEqual(
      expect.arrayContaining([
        'Blue Tokai',
        'Phoenix Mall',
        'Somewhere else',
        'Skip',
        'Type instead',
        "Don't ask this again",
        'Done',
      ]),
    );
    expect(textOf(tree(r))).toContain("Where was this — Blue Tokai (you're here now)?");
  });

  it('MC-FU-02 a place chip writes the place and moves on to the closing line', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    await press(r, 'Blue Tokai');
    expect(world.upsert).toHaveBeenCalledTimes(1);
    const call = world.upsert.mock.calls[0]![0] as {
      recordId: string;
      data: Record<string, unknown>;
    };
    expect(call.recordId).toBe('p1');
    expect(decodeTxn('p1', call.data).place).toBe('Blue Tokai');
    expect(textOf(tree(r))).toContain('Saved with place');
  });

  it('MC-FU-03 one Skip is remembered; the second in a row ends the chain', async () => {
    withHere();
    const r = mount(personal({ paymentMethod: null }));
    await flush();
    await press(r, 'Skip');
    expect((world.prefsNow!.prefs as { skips: Record<string, number> }).skips.place).toBe(1);
    expect(textOf(tree(r))).toContain('How did you pay?');
    await press(r, 'Skip');
    expect(textOf(tree(r))).not.toContain('How did you pay?');
    expect(labels(r)).not.toContain('Skip');
    expect(labels(r)).toContain('Done');
  });

  it('MC-FU-04 "Don\'t ask this again" mutes the type', async () => {
    withHere();
    const r = mount(personal());
    await flush();
    await press(r, "Don't ask this again");
    expect((world.prefsNow!.prefs as { muted: string[] }).muted).toContain('place');
  });

  it('MC-FU-05 a failed write shows the notice, keeps the chips live, and changes nothing', async () => {
    withHere();
    world.upsert.mockRejectedValueOnce(new Error('offline'));
    const r = mount(personal());
    await flush();
    await press(r, 'Blue Tokai');
    expect(textOf(tree(r))).toContain("Couldn't save that. Try again?");
    const chip = byLabel(r, 'Blue Tokai')!;
    expect(chip.props.disabled).toBe(false);
    expect(textOf(tree(r))).not.toContain('Saved with');
    expect(textOf(tree(r))).toContain('Where was this');
  });

  it('MC-FU-06 no question until the environment is known; then the question', async () => {
    withHere();
    let open!: () => void;
    world.placeGate = new Promise<void>((resolve) => (open = resolve));
    const r = mount(personal());
    await flush();
    expect(labels(r)).not.toContain('Skip');
    expect(findAll(tree(r), (n) => n.type === 'Button' && n.props.label === 'Done')).toHaveLength(
      1,
    );
    open();
    await flush();
    expect(labels(r)).toContain('Skip');
  });

  it('MC-FU-07 nothing to ask: a visible Saved beat for 1.2 s, then close', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 15, 0, 0));
    const r = mount(personal({ amount: 5000n }));
    await vi.advanceTimersByTimeAsync(10);
    expect(textOf(tree(r))).toContain('Saved ✓');
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1150);
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(world.toast).toHaveBeenCalledWith('Done');
  });

  it('MC-FU-08 the receipt chip opens the expense and the closing line says so', async () => {
    const r = mount(
      group({ category: 'travel', description: 'hotel', location: { lat: 1, lng: 2, name: 'x' } }),
      write,
    );
    await flush();
    expect(textOf(tree(r))).toContain('Got a receipt?');
    await press(r, 'Scan');
    expect(world.push).toHaveBeenCalledWith('/group/g1/expense/g-e1');
    expect(textOf(tree(r))).toContain('Opened it for you');
  });

  it('MC-FU-09 a typed answer goes to the agent with the question, and the update is applied', async () => {
    withHere();
    world.send.mockResolvedValue({
      kind: 'ok',
      response: { update: { expenseId: 'p1', place: 'Taj' } },
    });
    const r = mount(personal());
    await flush();
    await press(r, 'Type instead');
    const typed = findAll(tree(r), (n) => n.type === 'VoiceTypedAnswer')[0]!;
    await act(async () => {
      (typed.props.onSubmit as (t: string) => void)('at Taj');
    });
    await flush();
    const sent = world.send.mock.calls[0]![0] as { savedExpense: { id: string; question: string } };
    expect(sent.savedExpense.id).toBe('p1');
    expect(sent.savedExpense.question).toBe("Where was this — Blue Tokai (you're here now)?");
    const call = world.upsert.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(decodeTxn('p1', call.data).place).toBe('Taj');
  });

  it('MC-FU-09 an update for another expense is refused with "I couldn\'t use that"', async () => {
    withHere();
    world.send.mockResolvedValue({
      kind: 'ok',
      response: { update: { expenseId: 'other', place: 'Taj' } },
    });
    const r = mount(personal());
    await flush();
    await press(r, 'Type instead');
    const typed = findAll(tree(r), (n) => n.type === 'VoiceTypedAnswer')[0]!;
    await act(async () => {
      (typed.props.onSubmit as (t: string) => void)('at Taj');
    });
    await flush();
    expect(world.upsert).not.toHaveBeenCalled();
    expect(textOf(tree(r))).toContain("I couldn't use that");
  });

  it('MC-FU-10 offline: no Type instead, no typing chips, a caption instead', async () => {
    withHere();
    world.online = false;
    const r = mount(personal());
    await flush();
    expect(labels(r)).not.toContain('Type instead');
    expect(labels(r)).not.toContain('Somewhere else');
    expect(labels(r)).toContain('Blue Tokai');
    expect(textOf(tree(r))).toContain('Typing needs a connection');
  });

  it('MC-FU-11 "Same, remove mine" deletes the saved expense and stops the chain', async () => {
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
    const r = mount(group({ amount: 120000n, category: 'food', description: 'dinner' }), write);
    await flush();
    expect(textOf(tree(r))).toContain('Anu already added');
    await press(r, 'Same, remove mine');
    expect(world.removeExpense).toHaveBeenCalledWith('g-e1');
    expect(textOf(tree(r))).toContain('Removed the duplicate');
    expect(labels(r)).not.toContain('Skip');
  });

  it('MC-FU-12 "Yes, Ravi owes me" writes a lent loan and removes the personal entry', async () => {
    const r = mount(
      personal({ description: 'gave 5000 to Ravi', amount: 500000n, category: 'other' }),
    );
    await flush();
    await press(r, 'Yes, Ravi owes me');
    const loan = world.upsert.mock.calls.find(
      (c) => (c[0] as { recordKind: string }).recordKind === 'loan',
    )![0] as { data: Record<string, unknown> };
    expect(decodeLoan('l', loan.data)).toMatchObject({
      direction: 'lent',
      counterpart: 'Ravi',
      principal: 500000n,
    });
    expect(world.removePersonal).toHaveBeenCalledWith('p1');
  });

  it('MC-FU-13 "Repeat monthly" writes a reminder rule starting next month', async () => {
    world.txns = ['2026-09-20', '2026-08-21'].map((date, i) => ({
      id: `n${i}`,
      kind: 'expense',
      amount: 150000n,
      currency: 'INR',
      category: 'entertainment',
      note: 'Netflix',
      date,
    }));
    const r = mount(
      personal({ description: 'Netflix', amount: 150000n, category: 'entertainment', date: TODAY }),
    );
    await flush();
    await press(r, 'Repeat monthly');
    const rule = world.upsert.mock.calls.find(
      (c) => (c[0] as { recordKind: string }).recordKind === 'recurring',
    )![0] as { data: Record<string, unknown> };
    const decoded = decodeRecurring('r', rule.data);
    expect(decoded.autoPost).toBe(false);
    expect(decoded.nextDate).toBe(nextMonthlyDate(TODAY));
    expect(decoded.cadence).toBe('monthly');
  });

  it('MC-FU-14 the trip wrap-up is marked as shown the moment it appears', async () => {
    world.groups = [
      {
        id: 'g1',
        name: 'Goa trip',
        type: 'trip',
        start_date: '2026-10-01',
        end_date: '2026-10-10',
        archived_at: null,
        _members: [
          {
            id: 'm1',
            left_at: null,
            profile: { display_name: 'Me' },
            profile_id: 'u1',
            ghost_name: null,
          },
        ],
      },
    ];
    const r = mount(
      group({ category: 'groceries', description: 'taxi dues', amount: 60000n }),
      write,
    );
    await flush();
    expect(textOf(tree(r))).toContain('Goa trip looks finished');
    expect((world.prefsNow!.prefs as { wrapUpShown: string[] }).wrapUpShown).toContain('g1');
  });

  it('MC-FU-15 the currency chip relabels the currency and never converts', async () => {
    world.place = { lat: 25.2, lng: 55.3, name: null, countryCode: 'AE' };
    const r = mount(personal());
    await flush();
    expect(textOf(tree(r))).toContain('Was this in AED?');
    await press(r, 'AED');
    const call = world.upsert.mock.calls[0]![0] as { data: Record<string, unknown> };
    const txn = decodeTxn('p1', call.data);
    expect(txn.currency).toBe('AED');
    expect(txn.amount).toBe(800000n);
  });
});

describe('WS1 props and copy', () => {
  it('onSavedStateChange follows each write, and renderSavedBar sits under the headline', async () => {
    withHere();
    const seen: SavedState[] = [];
    const r = mount(personal(), null, {
      onSavedStateChange: (s: SavedState) => seen.push(s),
      renderSavedBar: (c: { headline: string }) => ({
        type: 'SavedBar',
        props: { headline: c.headline },
        key: null,
      }),
    });
    await flush();
    expect(findAll(tree(r), (n) => n.type === 'SavedBar')[0]?.props.headline).toBe(
      'Added ₹8,000.00 to Personal ✓',
    );
    await press(r, 'Blue Tokai');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.place).toBe('Blue Tokai');
  });

  it('chips are 40 high with a hit slop, and long labels are cut but stay readable to a screen reader', async () => {
    world.place = {
      lat: 1,
      lng: 2,
      name: 'The Very Long Named Cafe And Roastery',
      countryCode: 'IN',
    };
    const r = mount(personal());
    await flush();
    const chip = byLabel(r, 'The Very Long Named Cafe And Roastery')!;
    expect(chip.props.hitSlop).toBe(4);
    const style = (chip.props.style as (s: { pressed: boolean }) => { height: number })({
      pressed: false,
    });
    expect(style.height).toBe(40);
    expect(textOf(chip)).toBe('The Very Long Named Caf…');
  });

  it('questionText and questionReason are exported for every kind', async () => {
    const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');
    const f = STRINGS_BY_LANGUAGE.en.followUps;
    const ctx = {
      saved: personal(),
      group: { name: 'Goa trip' },
      amountLabel: '₹8,000',
      categoryLabel: (id: string) => id,
    };
    const base = { score: 50, places: [], hereNow: false, partners: [] };
    expect(questionReason({ ...base, kind: 'place', hereNow: true, places: ['x'] }, f, ctx)).toBe(
      "You're at a place right now",
    );
    expect(
      questionReason(
        {
          ...base,
          kind: 'trip',
          trip: { groupId: 'g', name: 'Goa', startDate: null, endDate: null, quietDays: null },
        },
        f,
        ctx,
      ),
    ).toBe('Goa is on right now');
    expect(questionReason({ ...base, kind: 'payment' }, f, ctx)).toBe('');
    expect(questionText({ ...base, kind: 'payment' }, f, ctx)).toBe('How did you pay?');
  });
});
