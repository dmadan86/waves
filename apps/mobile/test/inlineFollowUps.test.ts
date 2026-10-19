/** IN-F: same-screen follow-ups. Real card and pure plans, shallow inline tags.
 * The scorer is fixed per test so unrelated scoring changes cannot hide a write.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { VoiceFollowUps } from '../src/components/VoiceFollowUps';
import type { SavedState } from '../src/lib/followUpApply';
import type { AgentExpenseWrite, AgentLocalData } from '../src/lib/voiceAgentPlan';
import { act, findAll, flush, renderHook, textOf, type FakeElement } from './support/fakeReact';
import { inlineWorld, resetInlineWorld } from './support/inlineStubs';

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
  question: null as any,
  receipts: [] as any[],
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
  useOpenReceipts: () => ({ data: world.receipts, loading: false }),
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
// The card's mic is covered in voiceFollowUpsReply.test.ts; here no recorder exists.
vi.mock('@/lib/voiceReplyEngine', () => ({
  deviceReplyEngine: { supported: () => false, start: () => ({ stop() {}, cancel() {} }) },
}));
vi.mock('@/sync', async () => {
  const { inlineWorld: w } = await import('./support/inlineStubs');
  return { useSync: () => ({ mirror: {}, queue: {}, mutate: w.mutate }) };
});
vi.mock('expo-crypto', async () => (await import('./support/inlineStubs')).cryptoModule());
vi.mock('@/components/assistant/inline/useInlineReceipt', async () => ({
  useInlineReceipt: (await import('./support/inlineStubs')).useInlineReceiptStub,
}));
vi.mock('@/components/assistant/inline/InlineReceiptStatus', () => ({
  InlineReceiptStatus: 'InlineReceiptStatus',
}));
vi.mock('@/components/assistant/inline/InlineLoanShare', () => ({
  InlineLoanShare: 'InlineLoanShare',
}));
vi.mock('@/components/assistant/inline/InlineSettle', () => ({ InlineSettle: 'InlineSettle' }));
vi.mock('@/components/assistant/inline/InlineSheetHost', () => ({
  InlineSheetHost: 'InlineSheetHost',
}));
vi.mock('@waves/core', async (original) => ({
  ...(await original<typeof import('@waves/core')>()),
  nextFollowUp: (input: any) =>
    input.session.stopped || input.session.asked.includes(world.question?.kind)
      ? null
      : world.question,
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
  resetInlineWorld();
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
  world.receipts = [];
  world.question = {
    kind: 'split',
    score: 90,
    places: [],
    hereNow: false,
    partners: [{ name: 'Ravi', groupId: 'g1', memberId: 'm2' }],
  };
  world.removePersonal.mockResolvedValue('id');
  world.writeExpense.mockResolvedValue('id');
  world.upsert.mockImplementation(async () => 'rec');
});
afterEach(() => vi.useRealTimers());

const host = (r: ReturnType<typeof mount>) =>
  findAll(tree(r), (n) => n.type === 'InlineSheetHost')[0]!.props as any;
const question = (kind: string, extra = {}) => {
  world.question = { kind, score: 90, places: [], hereNow: false, partners: [], ...extra };
};
afterEach(() => expect(world.push).not.toHaveBeenCalled());
it('IN-F-01 partner chip opens a split request without navigating', async () => {
  const r = mount(personal());
  await flush();
  await press(r, 'Ravi');
  expect(host(r).request).toEqual({
    kind: 'split',
    groupId: 'g1',
    memberIds: ['m2'],
    from: 'split',
  });
  r.unmount();
});
it('IN-F-02 fallback creates before personal removal, guards double taps and closes with done note', async () => {
  let resolve!: () => void;
  inlineWorld.mutate.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  const r = mount(personal());
  await flush();
  await press(r, 'Ravi');
  const h = host(r);
  act(() => {
    h.onMove(h.request, 'g1', ['m2']);
    h.onMove(h.request, 'g1', ['m2']);
  });
  expect(inlineWorld.mutate).toHaveBeenCalledOnce();
  expect(inlineWorld.mutate.mock.calls[0]![0]).toBe('expense.create');
  expect(inlineWorld.mutate.mock.calls[0]![1]).toBe('g1');
  expect(world.removePersonal).not.toHaveBeenCalled();
  resolve();
  await flush();
  expect(world.removePersonal).toHaveBeenCalledExactlyOnceWith('p1');
  expect(inlineWorld.mutate.mock.invocationCallOrder[0]).toBeLessThan(
    world.removePersonal.mock.invocationCallOrder[0]!,
  );
  expect(host(r).request).toBeNull();
  expect(textOf(tree(r))).toContain('Split with Ravi ✓');
  r.unmount();
});
it('IN-F-03 failed fallback preserves source and sheet; retry reuses expense id', async () => {
  inlineWorld.mutate.mockRejectedValueOnce(Error('offline'));
  const r = mount(personal());
  await flush();
  await press(r, 'Ravi');
  let h = host(r);
  h.onMove(h.request, 'g1', ['m2']);
  await flush();
  expect(world.removePersonal).not.toHaveBeenCalled();
  expect(host(r).request.kind).toBe('split');
  expect(host(r).error).toBe("Couldn't save that. Try again?");
  h = host(r);
  h.onMove(h.request, 'g1', ['m2']);
  await flush();
  expect((inlineWorld.mutate.mock.calls[0]![2] as any).expenseId).toBe(
    (inlineWorld.mutate.mock.calls[1]![2] as any).expenseId,
  );
  expect(host(r).request).toBeNull();
  expect(textOf(tree(r))).toContain('Split with Ravi ✓');
  r.unmount();
});
it('IN-F-04 registered saved-bar mover receives plan, state and line; false keeps sheet open', async () => {
  const mover = vi.fn().mockResolvedValue(false);
  let controls: any;
  const initial = personal();
  const r = mount(initial, null, {
    renderSavedBar: (c: any) => {
      controls = c.controls;
      return null;
    },
  });
  await flush();
  controls.registerMover(mover);
  await press(r, 'Ravi');
  const h = host(r);
  h.onMove(h.request, 'g1', ['m2']);
  await flush();
  expect(mover).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'toGroup', groupId: 'g1' }),
    initial,
    undefined,
  );
  expect(inlineWorld.mutate).not.toHaveBeenCalled();
  expect(world.removePersonal).not.toHaveBeenCalled();
  expect(host(r).request.kind).toBe('split');
  expect(host(r).error).toBeTruthy();
  r.unmount();
});
it('IN-F-05 trip chip opens a trip request', async () => {
  question('trip', { trip: { groupId: 'g1', name: 'Goa trip' } });
  const r = mount(personal());
  await flush();
  const chip = labels(r).find((l) => l.includes('Goa trip'))!;
  await press(r, chip);
  expect(host(r).request).toEqual({ kind: 'trip', groupId: 'g1', from: 'trip' });
  r.unmount();
});
it('IN-F-06 attendance selection persists participants and leaves edit undo; unchanged writes nothing', async () => {
  question('attendance');
  const undo = vi.fn();
  const initial = group();
  const r = mount(initial, write, { onUndoable: undo });
  await flush();
  const pick = labels(r).find((l) => l.includes('Pick'))!;
  await press(r, pick);
  let h = host(r);
  expect(h.request).toEqual({ kind: 'attendance', from: 'attendance' });
  h.onAttendance(h.request, ['m1']);
  await flush();
  expect(world.writeExpense).toHaveBeenCalledOnce();
  expect(world.writeExpense.mock.calls[0]![0]).toMatchObject({ participants: ['m1'] });
  expect(undo).toHaveBeenCalledWith({ kind: 'edit', previous: initial, what: 'answer' });
  r.unmount();
  world.writeExpense.mockClear();
  const r2 = mount(initial, write);
  await flush();
  host(r2).onAttendance({ kind: 'attendance', from: 'attendance' }, ['m2', 'm1']);
  await flush();
  expect(world.writeExpense).not.toHaveBeenCalled();
  r2.unmount();
});
it('IN-F-07 attendance failure keeps sheet and error', async () => {
  question('attendance');
  world.writeExpense.mockRejectedValueOnce(Error());
  const r = mount(group(), write);
  await flush();
  await press(
    r,
    labels(r).find((l) => l.includes('Pick'))!,
  );
  const h = host(r);
  h.onAttendance(h.request, ['m1']);
  await flush();
  expect(host(r).request.kind).toBe('attendance');
  expect(host(r).error).toBeTruthy();
  r.unmount();
});
it('IN-F-08 itemize request rejects unclaimed lines and sends receipt itemized replacement through mover', async () => {
  question('receipt');
  world.receipts = [
    {
      id: 'receipt-row',
      claimed: 0,
      created_at: '2026-10-21',
      expense_id: 'g-e1',
      parsed: { currency: 'INR', items: [{ label: 'Dinner', total: 800000 }], grandTotal: 800000 },
    },
  ];
  const mover = vi.fn().mockResolvedValue(true);
  let controls: any;
  const r = mount(group(), write, {
    renderSavedBar: (c: any) => {
      controls = c.controls;
      return null;
    },
  });
  await flush();
  controls.registerMover(mover);
  await press(r, 'Split by item');
  let h = host(r);
  expect(h.request).toMatchObject({ kind: 'itemize', receiptId: 'receipt-row', from: 'receipt' });
  h.onItemize(h.request, {});
  expect(host(r).error).toBeTruthy();
  expect(mover).not.toHaveBeenCalled();
  h = host(r);
  h.onItemize(h.request, { 0: ['m1', 'm2'] });
  await flush();
  expect(mover).toHaveBeenCalledWith(
    expect.objectContaining({
      write: expect.objectContaining({
        receiptId: 'receipt-row',
        splitParams: expect.objectContaining({ kind: 'itemized' }),
      }),
    }),
    expect.anything(),
    'Split by item ✓',
  );
  expect(textOf(tree(r))).toContain('Split by item ✓');
  r.unmount();
});
it.each([true, false])(
  'IN-F-09 lend share=%s writes loan before removing spend and registers undo',
  async (share) => {
    question('lend', { person: 'Ravi' });
    const undo = vi.fn();
    const r = mount(personal(), null, { onUndoable: undo });
    await flush();
    const chip = share ? 'Yes, and show it to Ravi' : 'Yes, Ravi owes me';
    await press(r, chip);
    expect(world.upsert).toHaveBeenCalledWith(expect.objectContaining({ recordKind: 'loan' }));
    expect(world.removePersonal).toHaveBeenCalledWith('p1');
    expect(world.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      world.removePersonal.mock.invocationCallOrder[0]!,
    );
    expect(undo).toHaveBeenCalledWith(expect.objectContaining({ kind: 'lend', loanId: 'rec' }));
    const nodes = findAll(tree(r), (n) => n.type === 'InlineLoanShare');
    expect(nodes).toHaveLength(share ? 1 : 0);
    if (share)
      expect(nodes[0]!.props.loan).toMatchObject({
        direction: 'lent',
        counterpart: 'Ravi',
        principal: 800000n,
        currency: 'INR',
      });
    r.unmount();
  },
);
it.each([true, false])('IN-F-10 wrapup yes=%s stays inline', async (yes) => {
  question('wrapup', { trip: { groupId: 'g1', name: 'Goa trip' } });
  const r = mount(group(), write);
  await flush();
  await press(r, yes ? 'Settle up' : 'Not yet');
  const nodes = findAll(tree(r), (n) => n.type === 'InlineSettle');
  expect(nodes).toHaveLength(yes ? 1 : 0);
  if (yes) expect(nodes[0]!.props.groupId).toBe('g1');
  r.unmount();
});
it('IN-F-11 receipt Scan/Pick forward to picker; attachment and removal update saved state', async () => {
  question('receipt');
  const changed = vi.fn();
  const r = mount(group(), write, { onSavedStateChange: changed });
  await flush();
  await press(r, 'Scan');
  await press(
    r,
    labels(r).find((l) => /Choose|Pick/.test(l))!,
  );
  expect(inlineWorld.scan).toHaveBeenCalledOnce();
  expect(inlineWorld.pick).toHaveBeenCalledOnce();
  inlineWorld.receiptCallbacks!.onAttached();
  await flush();
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ hasReceipt: true }));
  expect(textOf(tree(r))).toContain('Receipt attached ✓');
  inlineWorld.receiptCallbacks!.onRemoved();
  await flush();
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ hasReceipt: false }));
  r.unmount();
});

it.each(['splitWith', 'wantsReceipt'])(
  'IN-F-12 model-driven %s stays over voice panel',
  async (kind) => {
    question('payment');
    const initial = kind === 'splitWith' ? personal() : group();
    world.send.mockResolvedValue({
      kind: 'ok',
      response: {
        update: {
          expenseId: initial.id,
          ...(kind === 'splitWith'
            ? { splitWith: { groupId: 'g1', memberIds: ['m2'] } }
            : { wantsReceipt: true }),
        },
      },
    });
    const r = mount(initial, kind === 'splitWith' ? null : write);
    await flush();
    await press(r, 'Type instead');
    const typed = findAll(tree(r), (n) => n.type === 'VoiceTypedAnswer')[0]!;
    act(() => {
      (typed.props.onSubmit as any)('please arrange the special request');
    });
    await flush();
    expect(world.send).toHaveBeenCalledOnce();
    if (kind === 'splitWith')
      expect(host(r).request).toEqual({
        kind: 'split',
        groupId: 'g1',
        memberIds: ['m2'],
        from: null,
      });
    else expect(inlineWorld.scan).toHaveBeenCalledOnce();
    r.unmount();
  },
);
it('IN-F-13 successful saved-bar mover closes sheet and marks question answered without fallback', async () => {
  let controls: any;
  const mover = vi.fn().mockResolvedValue(true);
  const r = mount(personal(), null, {
    renderSavedBar: (c: any) => {
      controls = c.controls;
      return null;
    },
  });
  await flush();
  controls.registerMover(mover);
  await press(r, 'Ravi');
  const h = host(r);
  h.onMove(h.request, 'g1', ['m2']);
  await flush();
  expect(host(r).request).toBeNull();
  expect(textOf(tree(r))).toContain('Split with Ravi ✓');
  expect(textOf(tree(r))).not.toContain('Split this with');
  expect(inlineWorld.mutate).not.toHaveBeenCalled();
  expect(world.removePersonal).not.toHaveBeenCalled();
  r.unmount();
});
it('IN-F-14 trip fallback rejects safely and retries same destination before removing personal entry', async () => {
  question('trip', { trip: { groupId: 'g1', name: 'Goa trip' } });
  inlineWorld.mutate.mockRejectedValueOnce(Error());
  const r = mount(personal());
  await flush();
  await press(
    r,
    labels(r).find((l) => l.includes('Goa trip'))!,
  );
  let h = host(r);
  h.onMove(h.request, 'g1', ['m2']);
  await flush();
  expect(host(r).error).toBeTruthy();
  expect(host(r).request.kind).toBe('trip');
  expect(world.removePersonal).not.toHaveBeenCalled();
  let resolve!: () => void;
  inlineWorld.mutate.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
  h = host(r);
  act(() => {
    h.onMove(h.request, 'g1', ['m2']);
    h.onMove(h.request, 'g1', ['m2']);
  });
  expect(inlineWorld.mutate).toHaveBeenCalledTimes(2);
  expect((inlineWorld.mutate.mock.calls[0]![2] as any).expenseId).toBe(
    (inlineWorld.mutate.mock.calls[1]![2] as any).expenseId,
  );
  expect(world.removePersonal).not.toHaveBeenCalled();
  resolve();
  await flush();
  expect(world.removePersonal).toHaveBeenCalledOnce();
  expect(host(r).request).toBeNull();
  expect(textOf(tree(r))).toContain('Goa trip ✓');
  r.unmount();
});
